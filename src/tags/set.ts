import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handlerScope } from '../component/scope';
import { valueAttributeToExpression } from '../utils/values';
import { SourceElement } from '../source-dom';

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
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail } = handlerDiagnostics('SET');

  try {
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');
    const op = (element.getAttribute('op') || '=').trim();

    if (!name) {
      return fail('SET tag requires a name attribute');
    }

    if (!ALLOWED_OPS.has(op)) {
      return fail(`Invalid op: ${op}`);
    }

    if ((op === '++' || op === '--') && (value || exprAttr)) {
      warnings.push({ message: 'value ignored for unary op', tag: 'SET' });
    }

    const parts = validatePath(name);
    if (!parts) {
      return fail(`Invalid path: ${name}`);
    }

    let processedValue = '';
    if (op !== '++' && op !== '--') {
      if (exprAttr && exprAttr.trim()) {
        processedValue = handlerScope(options).expression(exprAttr.trim());
      } else {
        if (!value) {
          return fail('SET requires a value unless using ++/--');
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
