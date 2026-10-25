import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { StyleDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { valueAttributeToExpression } from '../utils/values';
import { SourceElement } from '../source-dom';

function buildValueExpr(value: string): string {
  return valueAttributeToExpression(value, { allowReferences: false });
}

function isCssProperty(prop: string): boolean {
  return prop.startsWith('--') || prop.includes('-');
}

export const handleStyleTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, report, empty } = handlerDiagnostics('STYLE');

  try {
    const selector = element.getAttribute('selector');
    const propAttr =
      element.getAttribute('prop') || element.getAttribute('name');
    const valueAttr = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');

    if (!selector || !propAttr) {
      return fail('STYLE requires selector and prop attributes');
    }

    if (!SecurityValidator.isAllowedSelector(selector)) {
      return fail('Invalid CSS selector');
    }

    const prop = propAttr.trim();
    if (!prop) {
      return fail('STYLE prop is empty');
    }

    if (isCssProperty(prop)) {
      if (!/^(--[a-zA-Z0-9_-]+|[a-zA-Z][a-zA-Z0-9_-]*)$/.test(prop)) {
        return fail(`Invalid CSS property: ${prop}`);
      }
    } else if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop)) {
      return fail(`Invalid style property: ${prop}`);
    }

    const valueExpr =
      exprAttr && exprAttr.trim()
        ? handlerScope(options).expression(exprAttr.trim())
        : buildValueExpr(valueAttr);
    if (!valueExpr) {
      return fail('STYLE requires a value or expr');
    }

    const exprErrors = SecurityValidator.validateContent(valueExpr);
    if (exprErrors.length > 0) {
      report(exprErrors);
      if (options.strictMode) {
        return empty();
      }
    }

    const isComponentContext = options.parentContext === 'component';
    const selEsc = SecurityValidator.jsStringLiteral(selector);
    const propLiteral = SecurityValidator.jsStringLiteral(prop);

    const code = isComponentContext
      ? ''
      : `
      (function(){
        try {
          const targets = document.querySelectorAll(${selEsc});
          targets.forEach(node => {
            ${
              isCssProperty(prop)
                ? `node.style.setProperty(${propLiteral}, ${valueExpr});`
                : `node.style[${propLiteral}] = ${valueExpr};`
            }
          });
        } catch (error) {
          console.error('STYLE failed:', error);
        }
      })();`;

    const directive: StyleDirective = {
      kind: 'style',
      selector,
      property: prop,
      value: valueExpr,
      mode: isCssProperty(prop) ? 'css' : 'property',
    };

    CompilerLogger.logDebug('Generated style directive', {
      selector,
      property: prop,
      isCssProperty: isCssProperty(prop),
    });

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
      errors: [{ type: 'runtime', message: String(error), tag: 'STYLE' }],
      warnings,
    };
  }
};
