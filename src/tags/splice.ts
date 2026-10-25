import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { StateDirective } from '../component/ir';
import { SourceElement } from '../source-dom';

export const handleSpliceTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('SPLICE');

  try {
    const array = element.getAttribute('array');
    const index = element.getAttribute('index') || '0';
    const deleteCount = element.getAttribute('delete') || '0';
    const valuesAttr = element.getAttribute('values'); // JSON array or omitted

    if (!array) {
      return fail('SPLICE requires array attribute');
    }

    // Validate array path
    if (!SecurityValidator.isJavaScriptPath(array)) {
      return fail('Invalid array path');
    }
    for (const part of array.split('.')) {
      const ve = SecurityValidator.validateJavaScriptIdentifier(part);
      if (ve.length) {
        return failWith(ve);
      }
    }

    // Validate numbers
    const indexIsNumeric = SecurityValidator.isNumericLiteral(index);
    if (!indexIsNumeric) {
      const exprErrors = SecurityValidator.validateContent(index);
      if (exprErrors.length) {
        return failWith(exprErrors);
      }
    } else {
      const idxErr = SecurityValidator.validateNumericValue(index);
      if (idxErr.length) {
        return failWith(idxErr);
      }
    }
    const delErr = SecurityValidator.validateNumericValue(deleteCount);
    if (delErr.length) {
      return failWith(delErr);
    }

    // Values
    let tail = '';
    let valueExpressions: string[] = [];
    if (valuesAttr) {
      try {
        const parsed = JSON.parse(valuesAttr);
        if (!Array.isArray(parsed))
          throw new Error('values must be JSON array');
        valueExpressions = parsed.map((v) => JSON.stringify(v));
        tail = valueExpressions.length
          ? ', ' + valueExpressions.join(', ')
          : '';
      } catch {
        return fail('Invalid values JSON array');
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
      index: handlerScope(options).expression(index),
      deleteCount,
      values: valueExpressions,
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [stateDirective],
      },
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'SPLICE' }],
      warnings,
    };
  }
};
