import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { BindDirective, EventDirective, StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';
import { SourceElement } from '../source-dom';

const DEFAULT_EVENT = 'input';
const ALLOWED_EVENTS = new Set(['input', 'change', 'blur', 'keyup', 'keydown']);

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
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, report, empty } = handlerDiagnostics('MODEL');

  try {
    const selector = element.getAttribute('selector');
    const pathAttr =
      element.getAttribute('path') || element.getAttribute('name');
    const prop = element.getAttribute('prop') || 'value';
    const eventAttr = element.getAttribute('event') || DEFAULT_EVENT;
    const trimAttr = element.getAttribute('trim');

    if (!selector || !pathAttr) {
      return fail('MODEL requires selector and path attributes');
    }

    if (!SecurityValidator.isAllowedSelector(selector)) {
      return fail('Invalid CSS selector');
    }

    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop)) {
      return fail('Invalid property path');
    }

    if (!ALLOWED_EVENTS.has(eventAttr)) {
      return fail(`Invalid MODEL event: ${eventAttr}`);
    }

    const pathInfo = normalizePath(pathAttr);
    if (!pathInfo) {
      return fail(`Invalid model path: ${pathAttr}`);
    }

    const trim = trimAttr ? trimAttr.toLowerCase() === 'true' : false;
    const numberAttr = element.getAttribute('number');
    const numeric = numberAttr !== null && numberAttr.toLowerCase() !== 'false';
    const rawSource =
      prop === 'checked'
        ? 'event.currentTarget.checked'
        : prop === 'value' && trim
          ? 'event.currentTarget.value.trim()'
          : `event.currentTarget.${prop}`;
    // number="true" stores numbers (empty input → null) instead of strings.
    const sourceExpr = numeric
      ? `(${rawSource} === '' ? null : Number(${rawSource}))`
      : rawSource;

    const exprErrors = SecurityValidator.validateContent(pathInfo.expr);
    if (exprErrors.length > 0) {
      report(exprErrors);
      if (options.strictMode) {
        return empty();
      }
    }

    const bindDirective: BindDirective = {
      kind: 'bind',
      selector,
      property: prop,
      expression: pathInfo.expr,
    };

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'set',
      path: pathInfo.path,
      op: '=',
      value: sourceExpr,
    };

    const eventDirective: EventDirective = {
      kind: 'event',
      selector,
      eventType: eventAttr,
      body: [],
      directives: [stateDirective],
    };

    const isComponentContext = options.parentContext === 'component';
    const selEsc = SecurityValidator.jsStringLiteral(selector);
    const propEsc = SecurityValidator.jsStringLiteral(prop);
    const runtime = ensureRuntime();
    const assignment = pathAttr.startsWith('this.')
      ? pathAttr
      : `this.${pathAttr}`;

    const code = isComponentContext
      ? ''
      : `${runtime}
      (function(){
        try {
          if (typeof window !== 'undefined' && window.__htms) {
            window.__htms.bind(${selEsc}, ${propEsc}, function(){ return ${pathInfo.expr}; });
          }
          const targets = document.querySelectorAll(${selEsc});
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
      event: eventAttr,
    });

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [bindDirective, eventDirective],
      },
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'MODEL' }],
      warnings,
    };
  }
};
