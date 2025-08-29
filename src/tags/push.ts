import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

function buildValueExpr(value: string): string | null {
  if (!value) return 'undefined';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (value === 'true' || value === 'false' || value === 'null') return value;
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(value)) return value;
  const escaped = SecurityValidator.escapeForTemplate(value);
  return `"${escaped}"`;
}

export const handlePushTag: TagHandler = (
  element: Element,
  _options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const array = element.getAttribute('array');
    const value = element.getAttribute('value') || '';
    if (!array) {
      errors.push({ type: 'validation', message: 'PUSH requires array attribute', tag: 'PUSH' });
      return { code: '', errors, warnings };
    }
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(array)) {
      errors.push({ type: 'validation', message: 'Invalid array path', tag: 'PUSH' });
      return { code: '', errors, warnings };
    }
    for (const part of array.split('.')) {
      const errs = SecurityValidator.validateJavaScriptIdentifier(part);
      if (errs.length > 0) {
        errors.push(...errs.map(e => ({ ...e, tag: 'PUSH' })));
        return { code: '', errors, warnings };
      }
    }
    const valExpr = buildValueExpr(value);
    const code = `
      (function(){
        try { ${array}.push(${valExpr}); } catch (error) { console.error('PUSH failed:', error); }
        if (typeof window !== 'undefined' && window.__htms) { window.__htms.notify(); }
      })();`;
    CompilerLogger.logDebug('Generated push', { array });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'PUSH' }], warnings };
  }
};
