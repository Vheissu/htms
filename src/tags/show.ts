import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { VisibilityDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';

export const handleShowTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  const target = element.getAttribute('target');
  const when =
    element.getAttribute('when') || element.getAttribute('condition');
  if (!target || !when) {
    errors.push({
      type: 'validation',
      message: 'SHOW requires target and when attributes',
      tag: 'SHOW',
    });
    return { code: '', errors, warnings };
  }

  if (!SecurityValidator.isAllowedSelector(target)) {
    errors.push({
      type: 'validation',
      message: 'Invalid CSS selector format for target',
      tag: 'SHOW',
    });
    return { code: '', errors, warnings };
  }

  const condErrors = SecurityValidator.validateContent(when);
  if (condErrors.length > 0) {
    errors.push(...condErrors.map((e) => ({ ...e, tag: 'SHOW' })));
    return { code: '', errors, warnings };
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
