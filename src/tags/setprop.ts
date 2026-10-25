import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { AttributeDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { valueAttributeToExpression } from '../utils/values';
import { SourceElement } from '../source-dom';

const BLOCKED_PROPERTY_SINKS = new Set(['innerhtml', 'outerhtml', 'srcdoc']);

function buildValueExpr(value: string): string {
  return valueAttributeToExpression(value, { allowReferences: false });
}

export const handleSetPropTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('SETPROP');

  try {
    const selector = element.getAttribute('selector');
    const prop = element.getAttribute('prop');
    const value = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');
    if (!selector || !prop) {
      return fail('SETPROP requires selector and prop');
    }
    if (!SecurityValidator.isAllowedSelector(selector)) {
      return fail('Invalid CSS selector');
    }
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(prop)) {
      return fail('Invalid property path');
    }
    const rootProperty = prop.split('.')[0].toLowerCase();
    if (
      rootProperty.startsWith('on') ||
      BLOCKED_PROPERTY_SINKS.has(rootProperty)
    ) {
      return fail(`Dangerous property sink not allowed: ${prop}`, 'security');
    }

    const rawExpression = exprAttr?.trim() || value;
    const expressionErrors = SecurityValidator.validateContent(rawExpression);
    if (expressionErrors.length > 0) {
      return failWith(expressionErrors);
    }
    const valExpr =
      exprAttr && exprAttr.trim()
        ? handlerScope(options).expression(exprAttr.trim())
        : buildValueExpr(value);

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
