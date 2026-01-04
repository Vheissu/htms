import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { BindDirective, EventDirective, StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';

const DEFAULT_EVENT = 'input';
const ALLOWED_EVENTS = new Set([
  'input',
  'change',
  'blur',
  'keyup',
  'keydown'
]);

function normalizePath(raw: string): { path: string[]; expr: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const expr = trimmed.startsWith('this.') ? trimmed : `this.${trimmed}`;
  const withoutThis = trimmed.startsWith('this.') ? trimmed.slice(5) : trimmed;
  const parts = withoutThis.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const errs = SecurityValidator.validateJavaScriptIdentifier(part);
    if (errs.length > 0) {
      return null;
    }
  }
  return { path: parts, expr };
}

export const handleModelTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const selector = element.getAttribute('selector');
    const pathAttr = element.getAttribute('path') || element.getAttribute('name');
    const prop = element.getAttribute('prop') || 'value';
    const eventAttr = element.getAttribute('event') || DEFAULT_EVENT;
    const trimAttr = element.getAttribute('trim');

    if (!selector || !pathAttr) {
      errors.push({
        type: 'validation',
        message: 'MODEL requires selector and path attributes',
        tag: 'MODEL'
      });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(selector)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector', tag: 'MODEL' });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop)) {
      errors.push({ type: 'validation', message: 'Invalid property path', tag: 'MODEL' });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_EVENTS.has(eventAttr)) {
      errors.push({
        type: 'validation',
        message: `Invalid MODEL event: ${eventAttr}`,
        tag: 'MODEL'
      });
      return { code: '', errors, warnings };
    }

    const pathInfo = normalizePath(pathAttr);
    if (!pathInfo) {
      errors.push({
        type: 'validation',
        message: `Invalid model path: ${pathAttr}`,
        tag: 'MODEL'
      });
      return { code: '', errors, warnings };
    }

    const trim = trimAttr ? trimAttr.toLowerCase() === 'true' : false;
    const sourceExpr =
      prop === 'checked'
        ? 'event.currentTarget.checked'
        : prop === 'value' && trim
        ? 'event.currentTarget.value.trim()'
        : `event.currentTarget.${prop}`;

    const exprErrors = SecurityValidator.validateContent(pathInfo.expr);
    if (exprErrors.length > 0) {
      errors.push(...exprErrors.map(error => ({ ...error, tag: 'MODEL' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    const bindDirective: BindDirective = {
      kind: 'bind',
      selector,
      property: prop,
      expression: pathInfo.expr
    };

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'set',
      path: pathInfo.path,
      op: '=',
      value: sourceExpr
    };

    const eventDirective: EventDirective = {
      kind: 'event',
      selector,
      eventType: eventAttr,
      body: [],
      directives: [stateDirective]
    };

    const isComponentContext = options.parentContext === 'component';
    const selEsc = SecurityValidator.escapeForTemplate(selector);
    const propEsc = SecurityValidator.escapeForTemplate(prop);
    const runtime = ensureRuntime();
    const assignment = pathAttr.startsWith('this.') ? pathAttr : `this.${pathAttr}`;

    const code = isComponentContext
      ? ''
      : `${runtime}
      (function(){
        try {
          if (typeof window !== 'undefined' && window.__htms) {
            window.__htms.bind(\`${selEsc}\`, \`${propEsc}\`, function(){ return ${pathInfo.expr}; });
          }
          const targets = document.querySelectorAll(\`${selEsc}\`);
          targets.forEach(node => {
            node.addEventListener('${eventAttr}', function(event){
              try {
                ${assignment} = ${sourceExpr};
                if (window.__htms) { window.__htms.notify(); }
              } catch (error) {
                console.error('MODEL update failed:', error);
              }
            });
          });
        } catch (error) {
          console.error('MODEL failed:', error);
        }
      })();`;

    CompilerLogger.logDebug('Generated model binding', {
      selector,
      path: pathInfo.path.join('.'),
      prop,
      event: eventAttr
    });

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [bindDirective, eventDirective]
      }
    };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'MODEL' }], warnings };
  }
};
