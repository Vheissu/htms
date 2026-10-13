import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handlerScope } from '../component/scope';
import { valueAttributeToExpression } from '../utils/values';

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
      errors.push({
        type: 'validation',
        message: 'SET tag requires a name attribute',
        tag: 'SET',
      });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_OPS.has(op)) {
      errors.push({
        type: 'validation',
        message: `Invalid op: ${op}`,
        tag: 'SET',
      });
      return { code: '', errors, warnings };
    }

    if ((op === '++' || op === '--') && (value || exprAttr)) {
      warnings.push({ message: 'value ignored for unary op', tag: 'SET' });
    }

    const parts = validatePath(name);
    if (!parts) {
      errors.push({
        type: 'validation',
        message: `Invalid path: ${name}`,
        tag: 'SET',
      });
      return { code: '', errors, warnings };
    }

    let processedValue = '';
    if (op !== '++' && op !== '--') {
      if (exprAttr && exprAttr.trim()) {
        processedValue = handlerScope(options).expression(exprAttr.trim());
      } else {
        if (!value) {
          errors.push({
            type: 'validation',
            message: 'SET requires a value unless using ++/--',
            tag: 'SET',
          });
          return { code: '', errors, warnings };
        }

        processedValue = valueAttributeToExpression(value, {
          isReference: handlerScope(options).isReference,
        });
        processedValue = handlerScope(options).expression(processedValue);
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
      hasValue: op !== '++' && op !== '--',
    });

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'set',
      path: parts,
      op,
      value: op !== '++' && op !== '--' ? processedValue : undefined,
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [stateDirective],
      },
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Set tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'SET',
    };
    CompilerLogger.logCompilerError('Set tag handler error', {
      error: runtimeError.message,
    });
    return { code: '', errors: [runtimeError], warnings };
  }
};
