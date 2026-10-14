import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { AttributeDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleSetAttrTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  try {
    const selector = element.getAttribute('selector');
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';
    if (!selector || !name) {
      errors.push({
        type: 'validation',
        message: 'SETATTR requires selector and name',
        tag: 'SETATTR',
      });
      return { code: '', errors, warnings };
    }
    if (!SecurityValidator.isAllowedSelector(selector)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector',
        tag: 'SETATTR',
      });
      return { code: '', errors, warnings };
    }
    const attributeErrors = SecurityValidator.validateHtmlAttribute(
      name,
      value
    );
    if (attributeErrors.length > 0) {
      errors.push(
        ...attributeErrors.map((error) => ({ ...error, tag: 'SETATTR' }))
      );
      return { code: '', errors, warnings };
    }
    const sel = SecurityValidator.jsStringLiteral(selector);
    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `
      (function(){
        try {
          const el = document.querySelector(${sel});
          if (!el) { console.warn('SETATTR target not found: ${sel}'); return; }
          el.setAttribute(${SecurityValidator.jsStringLiteral(name)}, ${SecurityValidator.jsStringLiteral(value)});
        } catch (error) {
          console.error('SETATTR failed:', error);
        }
      })();`;
    CompilerLogger.logDebug('Generated setattr', { selector, name });
    // expr="..." sets a computed value; null/undefined/false remove the
    // attribute and true sets it empty (boolean attributes).
    const exprAttr = element.getAttribute('expr')?.trim();
    if (exprAttr) {
      const exprErrors = SecurityValidator.validateContent(exprAttr);
      if (exprErrors.length > 0) {
        errors.push(
          ...exprErrors.map((error) => ({ ...error, tag: 'SETATTR' }))
        );
        return { code: '', errors, warnings };
      }
    }
    const directive: AttributeDirective = {
      kind: 'attribute',
      selector,
      target: 'attribute',
      name,
      value: exprAttr
        ? handlerScope(options).expression(exprAttr)
        : JSON.stringify(value),
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
      errors: [{ type: 'runtime', message: String(error), tag: 'SETATTR' }],
      warnings,
    };
  }
};
