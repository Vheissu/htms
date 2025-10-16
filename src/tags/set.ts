import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

const ALLOWED_OPS = new Set(['=', '+=', '-=', '*=', '/=', '++', '--']);

function validatePath(path: string): string[] | null {
  const parts = path.split('.');
  for (const p of parts) {
    const errs = SecurityValidator.validateJavaScriptIdentifier(p);
    if (errs.length > 0) return null;
  }
  return parts;
}

export const handleSetTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');
    const op = (element.getAttribute('op') || '=').trim();

    if (!name) {
      errors.push({ type: 'validation', message: 'SET tag requires a name attribute', tag: 'SET' });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_OPS.has(op)) {
      errors.push({ type: 'validation', message: `Invalid op: ${op}`, tag: 'SET' });
      return { code: '', errors, warnings };
    }

    if ((op === '++' || op === '--') && (value || exprAttr)) {
      warnings.push({ message: 'value ignored for unary op', tag: 'SET' });
    }

    const parts = validatePath(name);
    if (!parts) {
      errors.push({ type: 'validation', message: `Invalid path: ${name}`, tag: 'SET' });
      return { code: '', errors, warnings };
    }

    let processedValue = '';
    if (op !== '++' && op !== '--') {
      if (exprAttr && exprAttr.trim()) {
        processedValue = exprAttr;
      } else {
        if (!value) {
          errors.push({ type: 'validation', message: 'SET requires a value unless using ++/--', tag: 'SET' });
          return { code: '', errors, warnings };
        }

        // Reuse VAR value processing rules
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) throw new Error('not array');
            processedValue = JSON.stringify(parsed);
          } catch {
            errors.push({ type: 'validation', message: 'Invalid JSON array literal', tag: 'SET' });
            return { code: '', errors, warnings };
          }
        } else if (value.startsWith('{') && value.endsWith('}')) {
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) throw new Error('not object');
            for (const key of Object.keys(parsed)) {
              const keyErrs = SecurityValidator.validateJavaScriptIdentifier(key);
              if (keyErrs.length > 0) {
                errors.push(...keyErrs.map(e => ({ ...e, tag: 'SET' })));
                return { code: '', errors, warnings };
              }
            }
            processedValue = JSON.stringify(parsed);
          } catch {
            errors.push({ type: 'validation', message: 'Invalid JSON object literal', tag: 'SET' });
            return { code: '', errors, warnings };
          }
        } else if (/^-?\d+(\.\d+)?$/.test(value)) {
          const numErrors = SecurityValidator.validateNumericValue(value);
          if (numErrors.length > 0) {
            errors.push(...numErrors.map(e => ({ ...e, tag: 'SET' })));
            return { code: '', errors, warnings };
          }
          processedValue = value;
        } else if (value === 'true' || value === 'false' || value === 'null') {
          processedValue = value;
        } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(value)) {
          // variable or dotted path reference
          processedValue = value;
        } else {
          const escaped = SecurityValidator.escapeForTemplate(value);
          processedValue = `"${escaped}"`;
        }
      }
    }

    const target = name; // already validated dotted path
    let assignment = '';
    if (op === '++' || op === '--') {
      assignment = `${target}${op}`;
    } else {
      assignment = `${target} ${op} ${processedValue}`;
    }

    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `try {
  ${assignment};
} catch (error) {
  console.error('Set operation failed:', error);
}
if (typeof window !== 'undefined' && window.__htms) { window.__htms.notify(); }`;

    CompilerLogger.logDebug('Generated set operation', {
      target,
      op,
      hasValue: op !== '++' && op !== '--'
    });

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'set',
      path: parts,
      op,
      value: op !== '++' && op !== '--' ? processedValue : undefined
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [stateDirective]
      }
    };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Set tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'SET'
    };
    CompilerLogger.logCompilerError('Set tag handler error', { error: runtimeError.message });
    return { code: '', errors: [runtimeError], warnings };
  }
};
