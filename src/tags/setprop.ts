import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

function buildValueExpr(value: string): string | null {
  if (!value) return 'undefined';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (value === 'true' || value === 'false' || value === 'null') return value;
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(value)) return value;
  // Fallback to string literal
  const escaped = SecurityValidator.escapeForTemplate(value);
  return `"${escaped}"`;
}

export const handleSetPropTag: TagHandler = (
  element: Element,
  _options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const selector = element.getAttribute('selector');
    const prop = element.getAttribute('prop');
    const value = element.getAttribute('value') || '';
    if (!selector || !prop) {
      errors.push({ type: 'validation', message: 'SETPROP requires selector and prop', tag: 'SETPROP' });
      return { code: '', errors, warnings };
    }
    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(selector)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector', tag: 'SETPROP' });
      return { code: '', errors, warnings };
    }
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(prop)) {
      errors.push({ type: 'validation', message: 'Invalid property path', tag: 'SETPROP' });
      return { code: '', errors, warnings };
    }
    const valExpr = buildValueExpr(value);
    if (valExpr == null) {
      errors.push({ type: 'validation', message: 'Invalid value', tag: 'SETPROP' });
      return { code: '', errors, warnings };
    }

    const sel = SecurityValidator.escapeForTemplate(selector);
    const parts = prop.split('.');
    const head = parts.shift()!;
    const tail = parts;
    let path = `el[\"${head}\"]`;
    for (const p of tail) path += `[\"${p}\"]`;

    const code = `
      (function(){
        try {
          const el = document.querySelector(\`${sel}\`);
          if (!el) { console.warn('SETPROP target not found: ${sel}'); return; }
          ${path} = ${valExpr};
        } catch (error) {
          console.error('SETPROP failed:', error);
        }
      })();`;

    CompilerLogger.logDebug('Generated setprop', { selector, prop });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'SETPROP' }], warnings };
  }
};

