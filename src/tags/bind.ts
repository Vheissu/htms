import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { BindDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

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

    const runtime = `
      (function(){
        if (typeof window === 'undefined') return;
        if (!window.__htms) {
          Object.defineProperty(window, '__htms', {
            value: {
              watchers: [],
              bind: function(sel, prop, fn){
                const el = document.querySelector(sel);
                if (!el) { console.warn('BIND target not found:', sel); return; }
                try { el[prop] = fn(); } catch (e) { console.error('BIND compute failed:', e); }
                this.watchers.push({ sel, prop, fn });
              },
              notify: function(){
                try {
                  this.watchers.forEach(w => {
                    const el = document.querySelector(w.sel);
                    if (!el) return;
                    el[w.prop] = w.fn();
                  });
                } catch (e) { console.error('BIND notify failed:', e); }
              }
            },
            writable: false
          });
        }
      })();`;

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
