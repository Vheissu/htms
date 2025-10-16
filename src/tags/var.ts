import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleVarTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';
    const mutable = (element.getAttribute('mutable') || 'false').toLowerCase() === 'true';

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'VAR tag requires a name attribute',
        tag: 'VAR'
      });
      return { code: '', errors, warnings };
    }

    // Validate variable name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      errors.push(...nameErrors.map(error => ({ ...error, tag: 'VAR' })));
      return { code: '', errors, warnings };
    }

    // Security validation of value
    const valueErrors = SecurityValidator.validateContent(value);
    if (valueErrors.length > 0) {
      errors.push(...valueErrors.map(error => ({ ...error, tag: 'VAR' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    let processedValue: string;

    // Handle different value types safely
    if (!value) {
      processedValue = 'undefined';
    }
    // Handle array literals
    else if (value.startsWith('[') && value.endsWith(']')) {
      try {
        // Validate that it's a proper JSON array
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) {
          errors.push({
            type: 'validation',
            message: 'Invalid array literal',
            tag: 'VAR'
          });
          return { code: '', errors, warnings };
        }
        
        // Ensure all array elements are safe
        for (const item of parsed) {
          if (typeof item === 'string') {
            const itemErrors = SecurityValidator.validateContent(item);
            if (itemErrors.length > 0) {
              errors.push(...itemErrors.map(error => ({ ...error, tag: 'VAR' })));
              if (options.strictMode) {
                return { code: '', errors, warnings };
              }
            }
          } else if (typeof item !== 'number' && typeof item !== 'boolean' && item !== null) {
            errors.push({
              type: 'validation',
              message: `Unsupported array element type: ${typeof item}`,
              tag: 'VAR'
            });
            return { code: '', errors, warnings };
          }
        }
        
        processedValue = JSON.stringify(parsed);
      } catch {
        errors.push({
          type: 'validation',
          message: 'Invalid JSON array literal',
          tag: 'VAR'
        });
        return { code: '', errors, warnings };
      }
    }
    // Handle object literals
    else if (value.startsWith('{') && value.endsWith('}')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          errors.push({ type: 'validation', message: 'Invalid object literal', tag: 'VAR' });
          return { code: '', errors, warnings };
        }

        const validateNested = (v: unknown): boolean => {
          if (v === null) return true;
          const t = typeof v;
          if (t === 'number' || t === 'boolean') return true;
          if (t === 'string') {
            const ve = SecurityValidator.validateContent(v as string);
            if (ve.length > 0 && options.strictMode) return false;
            return true;
          }
          if (Array.isArray(v)) {
            return v.every(validateNested);
          }
          if (t === 'object') {
            for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
              const ke = SecurityValidator.validateJavaScriptIdentifier(k);
              if (ke.length > 0) return false;
              if (!validateNested(vv)) return false;
            }
            return true;
          }
          return false;
        };

        if (!validateNested(parsed)) {
          errors.push({ type: 'validation', message: 'Invalid nested value in object literal', tag: 'VAR' });
          return { code: '', errors, warnings };
        }

        processedValue = JSON.stringify(parsed);
      } catch {
        errors.push({ type: 'validation', message: 'Invalid JSON object literal', tag: 'VAR' });
        return { code: '', errors, warnings };
      }
    }
    // Handle quoted string literal (preserve quotes)
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      processedValue = value;
    }
    // Handle numeric values
    else if (/^-?\d+(\.\d+)?$/.test(value)) {
      const numErrors = SecurityValidator.validateNumericValue(value);
      if (numErrors.length > 0) {
        errors.push(...numErrors.map(error => ({ ...error, tag: 'VAR' })));
        return { code: '', errors, warnings };
      }
      processedValue = value;
    }
    // Handle boolean values
    else if (value === 'true' || value === 'false') {
      processedValue = value;
    }
    // Handle null
    else if (value === 'null') {
      processedValue = 'null';
    }
    // Handle variable references
    else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value)) {
      const varErrors = SecurityValidator.validateJavaScriptIdentifier(value);
      if (varErrors.length > 0) {
        errors.push(...varErrors.map(error => ({ ...error, tag: 'VAR' })));
        return { code: '', errors, warnings };
      }
      processedValue = value;
    }
    // Default to string literal (escaped)
    else {
      const escapedValue = SecurityValidator.escapeForTemplate(value);
      processedValue = `"${escapedValue}"`;
      
      warnings.push({
        message: 'Value treated as string literal and escaped for security',
        tag: 'VAR'
      });
    }

    const decl = mutable ? 'let' : 'const';
    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext ? '' : `${decl} ${name} = ${processedValue};`;

    CompilerLogger.logDebug('Generated variable declaration', {
      name,
      originalValue: value,
      processedValue,
      generatedCode: code,
      mutable
    });

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'init',
      path: name.split('.'),
      value: processedValue
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
    const runtimeError = {
      type: 'runtime' as const,
      message: `Var tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'VAR'
    };
    
    CompilerLogger.logCompilerError('Var tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};
