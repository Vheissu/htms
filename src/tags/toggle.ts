import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { VisibilityDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleToggleTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('TOGGLE');

  try {
    const target = element.getAttribute('target');
    const condition = element.getAttribute('condition');
    if (!target || !condition) {
      return fail('TOGGLE requires target and condition');
    }

    if (!SecurityValidator.isAllowedSelector(target)) {
      return fail('Invalid CSS selector format for target');
    }

    const condErrors = SecurityValidator.validateContent(condition);
    if (condErrors.length > 0) {
      return failWith(condErrors);
    }

    const sel = SecurityValidator.jsStringLiteral(target);
    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `
      (function(){
        try {
          const el = document.querySelector(${sel});
          if (!el) { console.warn('TOGGLE target not found: ${sel}'); return; }
          el.style.display = (${condition}) ? '' : 'none';
        } catch (error) {
          console.error('TOGGLE failed:', error);
        }
      })();`;

    CompilerLogger.logDebug('Generated toggle', { target, condition });
    const directive: VisibilityDirective = {
      kind: 'visibility',
      selector: target,
      condition: handlerScope(options).expression(condition),
      mode: 'toggle',
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
      errors: [{ type: 'runtime', message: String(error), tag: 'TOGGLE' }],
      warnings,
    };
  }
};
