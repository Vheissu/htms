import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { StyleDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { valueAttributeToExpression } from '../utils/values';
import { SourceElement } from '../source-dom';

function buildValueExpr(value: string): string | null {
  return valueAttributeToExpression(value, { allowReferences: false });
}

function isCssProperty(prop: string): boolean {
  return prop.startsWith('--') || prop.includes('-');
}

export const handleStyleTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const selector = element.getAttribute('selector');
    const propAttr =
      element.getAttribute('prop') || element.getAttribute('name');
    const valueAttr = element.getAttribute('value') || '';
    const exprAttr = element.getAttribute('expr');

    if (!selector || !propAttr) {
      errors.push({
        type: 'validation',
        message: 'STYLE requires selector and prop attributes',
        tag: 'STYLE',
      });
      return { code: '', errors, warnings };
    }

    if (!SecurityValidator.isAllowedSelector(selector)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector',
        tag: 'STYLE',
      });
      return { code: '', errors, warnings };
    }

    const prop = propAttr.trim();
    if (!prop) {
      errors.push({
        type: 'validation',
        message: 'STYLE prop is empty',
        tag: 'STYLE',
      });
      return { code: '', errors, warnings };
    }

    if (isCssProperty(prop)) {
      if (!/^(--[a-zA-Z0-9_-]+|[a-zA-Z][a-zA-Z0-9_-]*)$/.test(prop)) {
        errors.push({
          type: 'validation',
          message: `Invalid CSS property: ${prop}`,
          tag: 'STYLE',
        });
        return { code: '', errors, warnings };
      }
    } else if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop)) {
      errors.push({
        type: 'validation',
        message: `Invalid style property: ${prop}`,
        tag: 'STYLE',
      });
      return { code: '', errors, warnings };
    }

    const valueExpr =
      exprAttr && exprAttr.trim()
        ? handlerScope(options).expression(exprAttr.trim())
        : buildValueExpr(valueAttr);
    if (!valueExpr) {
      errors.push({
        type: 'validation',
        message: 'STYLE requires a value or expr',
        tag: 'STYLE',
      });
      return { code: '', errors, warnings };
    }

    const exprErrors = SecurityValidator.validateContent(valueExpr);
    if (exprErrors.length > 0) {
      errors.push(...exprErrors.map((error) => ({ ...error, tag: 'STYLE' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
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
