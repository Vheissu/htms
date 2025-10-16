import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { StateDirective } from '../component/ir';

export const handleSpliceTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
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
    const indexIsNumeric = /^-?\\d+(\\.\\d+)?$/.test(index);
    if (!indexIsNumeric) {
      const exprErrors = SecurityValidator.validateContent(index);
      if (exprErrors.length) {
        errors.push(...exprErrors.map(e => ({ ...e, tag: 'SPLICE' })));
        return { code: '', errors, warnings };
      }
    } else {
      const idxErr = SecurityValidator.validateNumericValue(index);
      if (idxErr.length) { errors.push(...idxErr.map(e => ({ ...e, tag: 'SPLICE' }))); return { code: '', errors, warnings }; }
    }
    const delErr = SecurityValidator.validateNumericValue(deleteCount);
    if (delErr.length) { errors.push(...delErr.map(e => ({ ...e, tag: 'SPLICE' }))); return { code: '', errors, warnings }; }

    // Values
    let tail = '';
    let valueExpressions: string[] = [];
    if (valuesAttr) {
      try {
        const parsed = JSON.parse(valuesAttr);
        if (!Array.isArray(parsed)) throw new Error('values must be JSON array');
        valueExpressions = parsed.map(v =>
          typeof v === 'string' ? `"${SecurityValidator.escapeForTemplate(v)}"` : String(v)
        );
        tail = valueExpressions.length ? ', ' + valueExpressions.join(', ') : '';
      } catch {
        errors.push({ type: 'validation', message: 'Invalid values JSON array', tag: 'SPLICE' });
        return { code: '', errors, warnings };
      }
    }

    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `
      (function(){
        try { ${array}.splice(${index}, ${deleteCount}${tail}); } catch (error) { console.error('SPLICE failed:', error); }
        if (typeof window !== 'undefined' && window.__htms) { window.__htms.notify(); }
      })();`;

    CompilerLogger.logDebug('Generated splice', { array });
    const path = array.split('.');
    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'splice',
      path,
      index,
      deleteCount,
      values: valueExpressions
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [stateDirective]
      }
    };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'SPLICE' }], warnings };
  }
};
