import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { BindDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';

export const handleBindTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const selector = element.getAttribute('selector');
    const prop = element.getAttribute('prop') || 'textContent';
    const expr = element.getAttribute('expr');

    if (!selector || !expr) {
      errors.push({ type: 'validation', message: 'BIND requires selector and expr', tag: 'BIND' });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(selector)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector', tag: 'BIND' });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(prop)) {
      errors.push({ type: 'validation', message: 'Invalid property name', tag: 'BIND' });
      return { code: '', errors, warnings };
    }

    const exprErrors = SecurityValidator.validateContent(expr);
    if (exprErrors.length > 0) {
      errors.push(...exprErrors.map(e => ({ ...e, tag: 'BIND' })));
      return { code: '', errors, warnings };
    }

    const selEsc = SecurityValidator.escapeForTemplate(selector);
    const propEsc = SecurityValidator.escapeForTemplate(prop);

    const runtime = ensureRuntime();

    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `${runtime}
      (function(){
        if (typeof window !== 'undefined' && window.__htms) {
          window.__htms.bind(\`${selEsc}\`, \`${propEsc}\`, function(){ return ${expr}; });
        }
      })();`;

    CompilerLogger.logDebug('Generated bind', { selector, prop });
    const directive: BindDirective = {
      kind: 'bind',
      selector,
      property: prop,
      expression: expr
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [directive]
      }
    };

  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'BIND' }], warnings };
  }
};
