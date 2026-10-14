import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { AttributeDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { valueAttributeToExpression } from '../utils/values';
import { SourceElement } from '../source-dom';

const BLOCKED_PROPERTY_SINKS = new Set(['innerhtml', 'outerhtml', 'srcdoc']);

function buildValueExpr(value: string): string | null {
  return valueAttributeToExpression(value, { allowReferences: false });
}

export const handleSetPropTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const selector = element.getAttribute('selector');
    const prop = element.getAttribute('prop');
    const value = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');
    if (!selector || !prop) {
      errors.push({
        type: 'validation',
        message: 'SETPROP requires selector and prop',
        tag: 'SETPROP',
      });
      return { code: '', errors, warnings };
    }
    if (!SecurityValidator.isAllowedSelector(selector)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector',
        tag: 'SETPROP',
      });
      return { code: '', errors, warnings };
    }
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(prop)) {
      errors.push({
        type: 'validation',
        message: 'Invalid property path',
        tag: 'SETPROP',
      });
      return { code: '', errors, warnings };
    }
    const rootProperty = prop.split('.')[0].toLowerCase();
    if (
      rootProperty.startsWith('on') ||
      BLOCKED_PROPERTY_SINKS.has(rootProperty)
    ) {
      errors.push({
        type: 'security',
        message: `Dangerous property sink not allowed: ${prop}`,
        tag: 'SETPROP',
      });
      return { code: '', errors, warnings };
    }

    const rawExpression = exprAttr?.trim() || value;
    const expressionErrors = SecurityValidator.validateContent(rawExpression);
    if (expressionErrors.length > 0) {
      errors.push(
        ...expressionErrors.map((error) => ({ ...error, tag: 'SETPROP' }))
      );
      return { code: '', errors, warnings };
    }
    const valExpr =
      exprAttr && exprAttr.trim()
        ? handlerScope(options).expression(exprAttr.trim())
        : buildValueExpr(value);
    if (valExpr == null) {
      errors.push({
        type: 'validation',
        message: 'Invalid value',
        tag: 'SETPROP',
      });
      return { code: '', errors, warnings };
    }

    const sel = SecurityValidator.jsStringLiteral(selector);
    const parts = prop.split('.');
    const head = parts.shift()!;
    const tail = parts;
    let path = `el[${JSON.stringify(head)}]`;
    for (const p of tail) path += `[${JSON.stringify(p)}]`;

    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `
      (function(){
        try {
          const el = document.querySelector(${sel});
          if (!el) { console.warn('SETPROP target not found: ${sel}'); return; }
          ${path} = ${valExpr};
        } catch (error) {
          console.error('SETPROP failed:', error);
        }
      })();`;

    CompilerLogger.logDebug('Generated setprop', { selector, prop });
    const pathSegments = prop.split('.');

    const directive: AttributeDirective = {
      kind: 'attribute',
      selector,
      target: 'property',
      name: prop,
      path: pathSegments,
      value: valExpr,
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [directive],
      },
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'SETPROP' }],
      warnings,
    };
  }
};
