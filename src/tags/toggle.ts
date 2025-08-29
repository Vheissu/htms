import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleToggleTag: TagHandler = (
  element: Element,
  _options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    const condition = element.getAttribute('condition');
    if (!target || !condition) {
      errors.push({ type: 'validation', message: 'TOGGLE requires target and condition', tag: 'TOGGLE' });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(target)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector format for target', tag: 'TOGGLE' });
      return { code: '', errors, warnings };
    }

    const condErrors = SecurityValidator.validateContent(condition);
    if (condErrors.length > 0) {
      errors.push(...condErrors.map(e => ({ ...e, tag: 'TOGGLE' })));
      return { code: '', errors, warnings };
    }

    const sel = SecurityValidator.escapeForTemplate(target);
    const code = `
      (function(){
        try {
          const el = document.querySelector(\`${sel}\`);
          if (!el) { console.warn('TOGGLE target not found: ${sel}'); return; }
          el.style.display = (${condition}) ? '' : 'none';
        } catch (error) {
          console.error('TOGGLE failed:', error);
        }
      })();`;

    CompilerLogger.logDebug('Generated toggle', { target, condition });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'TOGGLE' }], warnings };
  }
};

