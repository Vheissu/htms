import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleSubmitTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    const prevent = (element.getAttribute('prevent') || 'true').toLowerCase() !== 'false';

    if (!target) {
      errors.push({ type: 'validation', message: 'SUBMIT requires target', tag: 'SUBMIT' });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(target)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector format for target', tag: 'SUBMIT' });
      return { code: '', errors, warnings };
    }

    // Build body from child tags
    let bodyCode = '';
    for (const child of Array.from(element.children)) {
      const { handleElement } = require('../handlers');
      const r = handleElement(child, options);
      if (r.errors.length > 0) {
        errors.push(...r.errors.map((e: any) => ({ ...e, tag: 'SUBMIT' })));
        if (options.strictMode) return { code: '', errors, warnings };
      }
      if (r.warnings.length > 0) warnings.push(...r.warnings);
      if (r.code) bodyCode += r.code + '\n';
    }

    const sel = SecurityValidator.escapeForTemplate(target);
    const code = `
      try {
        const forms = document.querySelectorAll(\`${sel}\`);
        if (forms.length === 0) {
          console.warn('No elements found for submit target: ${sel}');
        }
        forms.forEach(function(element){
          element.addEventListener('submit', function(event){
            try {
              ${prevent ? 'event.preventDefault && event.preventDefault();' : ''}
${bodyCode.split('\n').filter(Boolean).map((l: string) => '              ' + l).join('\n')}
            } catch (error) {
              console.error('Submit handler error:', error);
            }
          });
        });
      } catch (error) {
        console.error('Submit setup failed:', error);
      }`;

    CompilerLogger.logDebug('Generated submit handler', { target: sel, prevent });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'SUBMIT' }], warnings };
  }
};

