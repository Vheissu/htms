import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleSpliceTag: TagHandler = (
  element: Element,
  _options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const array = element.getAttribute('array');
    const index = element.getAttribute('index') || '0';
    const deleteCount = element.getAttribute('delete') || '0';
    const valuesAttr = element.getAttribute('values'); // JSON array or omitted

    if (!array) {
      errors.push({ type: 'validation', message: 'SPLICE requires array attribute', tag: 'SPLICE' });
      return { code: '', errors, warnings };
    }

    // Validate array path
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(array)) {
      errors.push({ type: 'validation', message: 'Invalid array path', tag: 'SPLICE' });
      return { code: '', errors, warnings };
    }
    for (const part of array.split('.')) {
      const ve = SecurityValidator.validateJavaScriptIdentifier(part);
      if (ve.length) {
        errors.push(...ve.map(e => ({ ...e, tag: 'SPLICE' })));
        return { code: '', errors, warnings };
      }
    }

    // Validate numbers
    const idxErr = SecurityValidator.validateNumericValue(index);
    if (idxErr.length) { errors.push(...idxErr.map(e => ({ ...e, tag: 'SPLICE' }))); return { code: '', errors, warnings }; }
    const delErr = SecurityValidator.validateNumericValue(deleteCount);
    if (delErr.length) { errors.push(...delErr.map(e => ({ ...e, tag: 'SPLICE' }))); return { code: '', errors, warnings }; }

    // Values
    let tail = '';
    if (valuesAttr) {
      try {
        const parsed = JSON.parse(valuesAttr);
        if (!Array.isArray(parsed)) throw new Error('values must be JSON array');
        const parts = parsed.map(v => typeof v === 'string' ? `"${SecurityValidator.escapeForTemplate(v)}"` : String(v));
        tail = parts.length ? ', ' + parts.join(', ') : '';
      } catch {
        errors.push({ type: 'validation', message: 'Invalid values JSON array', tag: 'SPLICE' });
        return { code: '', errors, warnings };
      }
    }

    const code = `
      (function(){
        try { ${array}.splice(${index}, ${deleteCount}${tail}); } catch (error) { console.error('SPLICE failed:', error); }
        if (typeof window !== 'undefined' && window.__htms) { window.__htms.notify(); }
      })();`;

    CompilerLogger.logDebug('Generated splice', { array });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'SPLICE' }], warnings };
  }
};
