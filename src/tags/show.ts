import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { VisibilityDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleShowTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('SHOW');

  const target = element.getAttribute('target');
  const when =
    element.getAttribute('when') || element.getAttribute('condition');
  if (!target || !when) {
    return fail('SHOW requires target and when attributes');
  }

  if (!SecurityValidator.isAllowedSelector(target)) {
    return fail('Invalid CSS selector format for target');
  }

  const condErrors = SecurityValidator.validateContent(when);
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
          if (!el) { console.warn('SHOW target not found: ${sel}'); return; }
          el.style.display = (${when}) ? '' : 'none';
        } catch (error) {
          console.error('SHOW failed:', error);
        }
      })();`;

  CompilerLogger.logDebug('Generated show', { target, when });
  const directive: VisibilityDirective = {
    kind: 'visibility',
    selector: target,
    condition: handlerScope(options).expression(when),
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
};
