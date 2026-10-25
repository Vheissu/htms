import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { BindDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';
import { SourceElement } from '../source-dom';

export const handleBindTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('BIND');

  try {
    const selector = element.getAttribute('selector');
    const prop = element.getAttribute('prop') || 'textContent';
    const expr = element.getAttribute('expr');

    if (!selector || !expr) {
      return fail('BIND requires selector and expr');
    }

    if (!SecurityValidator.isAllowedSelector(selector)) {
      return fail('Invalid CSS selector');
    }

    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(prop)) {
      return fail('Invalid property name');
    }

    const exprErrors = SecurityValidator.validateContent(expr);
    if (exprErrors.length > 0) {
      return failWith(exprErrors);
    }

    const selEsc = SecurityValidator.jsStringLiteral(selector);
    const propEsc = SecurityValidator.jsStringLiteral(prop);

    const runtime = ensureRuntime();

    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `${runtime}
      (function(){
        if (typeof window !== 'undefined' && window.__htms) {
          window.__htms.bind(${selEsc}, ${propEsc}, function(){ return ${expr}; });
        }
      })();`;

    CompilerLogger.logDebug('Generated bind', { selector, prop });
    const directive: BindDirective = {
      kind: 'bind',
      selector,
      property: prop,
      expression: handlerScope(options).expression(expr),
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
      errors: [{ type: 'runtime', message: String(error), tag: 'BIND' }],
      warnings,
    };
  }
};
