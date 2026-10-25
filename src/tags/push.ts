import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handlerScope } from '../component/scope';
import { valueAttributeToExpression } from '../utils/values';
import { StateDirective } from '../component/ir';
import { SourceElement } from '../source-dom';

function buildValueExpr(
  value: string,
  options: TagHandlerOptions
): string | null {
  return valueAttributeToExpression(value, {
    isReference: handlerScope(options).isReference,
  });
}

export const handlePushTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('PUSH');

  try {
    const array = element.getAttribute('array');
    const value = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');
    if (!array) {
      return fail('PUSH requires array attribute');
    }
    if (!SecurityValidator.isJavaScriptPath(array)) {
      return fail('Invalid array path');
    }
    for (const part of array.split('.')) {
      const errs = SecurityValidator.validateJavaScriptIdentifier(part);
      if (errs.length > 0) {
        return failWith(errs);
      }
    }
    const valExpr = handlerScope(options).expression(
      (exprAttr && exprAttr.trim()
        ? exprAttr
        : buildValueExpr(value, options)) ?? 'undefined'
    );
    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `
      (function(){
        try { ${array}.push(${valExpr}); } catch (error) { console.error('PUSH failed:', error); }
        if (typeof window !== 'undefined' && window.__htms) { window.__htms.notify(); }
      })();`;
    CompilerLogger.logDebug('Generated push', { array });
    const path = array.split('.');
    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'push',
      path,
      value: valExpr ?? 'undefined',
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
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'PUSH' }],
      warnings,
    };
  }
};
