import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleSetAttrTag: TagHandler = (
  element: Element,
  _options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  try {
    const selector = element.getAttribute('selector');
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';
    if (!selector || !name) {
      errors.push({ type: 'validation', message: 'SETATTR requires selector and name', tag: 'SETATTR' });
      return { code: '', errors, warnings };
    }
    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(selector)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector', tag: 'SETATTR' });
      return { code: '', errors, warnings };
    }
    const sel = SecurityValidator.escapeForTemplate(selector);
    const nameEsc = SecurityValidator.escapeForTemplate(name);
    const valEsc = SecurityValidator.escapeForTemplate(value);
    const code = `
      (function(){
        try {
          const el = document.querySelector(\`${sel}\`);
          if (!el) { console.warn('SETATTR target not found: ${sel}'); return; }
          el.setAttribute('${nameEsc}', '${valEsc}');
        } catch (error) {
          console.error('SETATTR failed:', error);
        }
      })();`;
    CompilerLogger.logDebug('Generated setattr', { selector, name });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'SETATTR' }], warnings };
  }
};

