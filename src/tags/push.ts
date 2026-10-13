import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handlerScope } from '../component/scope';
import { valueAttributeToExpression } from '../utils/values';
import { StateDirective } from '../component/ir';

function buildValueExpr(
  value: string,
  options: TagHandlerOptions
): string | null {
  return valueAttributeToExpression(value, {
    isReference: handlerScope(options).isReference,
  });
}

export const handlePushTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const array = element.getAttribute('array');
    const value = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');
    if (!array) {
      errors.push({
        type: 'validation',
        message: 'PUSH requires array attribute',
        tag: 'PUSH',
      });
      return { code: '', errors, warnings };
    }
    if (!SecurityValidator.isJavaScriptPath(array)) {
      errors.push({
        type: 'validation',
        message: 'Invalid array path',
        tag: 'PUSH',
      });
      return { code: '', errors, warnings };
    }
    for (const part of array.split('.')) {
      const errs = SecurityValidator.validateJavaScriptIdentifier(part);
      if (errs.length > 0) {
        errors.push(...errs.map((e) => ({ ...e, tag: 'PUSH' })));
        return { code: '', errors, warnings };
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
