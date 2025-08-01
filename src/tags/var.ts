import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
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
        // Validate that it's a proper JSON object
        const parsed = JSON.parse(value);
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          errors.push({
            type: 'validation',
            message: 'Invalid object literal',
            tag: 'VAR'
          });
          return { code: '', errors, warnings };
        }
        
        // Validate object properties
        for (const [key, val] of Object.entries(parsed)) {
          const keyErrors = SecurityValidator.validateJavaScriptIdentifier(key);
          if (keyErrors.length > 0) {
            errors.push(...keyErrors.map(error => ({ ...error, tag: 'VAR' })));
            return { code: '', errors, warnings };
          }
          
          if (typeof val === 'string') {
            const valErrors = SecurityValidator.validateContent(val);
            if (valErrors.length > 0) {
              errors.push(...valErrors.map(error => ({ ...error, tag: 'VAR' })));
              if (options.strictMode) {
                return { code: '', errors, warnings };
              }
            }
          } else if (typeof val !== 'number' && typeof val !== 'boolean' && val !== null) {
            errors.push({
              type: 'validation',
              message: `Unsupported object property type: ${typeof val}`,
              tag: 'VAR'
            });
            return { code: '', errors, warnings };
          }
        }
        
        processedValue = JSON.stringify(parsed);
      } catch {
        errors.push({
          type: 'validation',
          message: 'Invalid JSON object literal',
          tag: 'VAR'
        });
        return { code: '', errors, warnings };
      }
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

    const code = `const ${name} = ${processedValue};`;

    CompilerLogger.logDebug('Generated variable declaration', {
      name,
      originalValue: value,
      processedValue,
      generatedCode: code
    });

    return { code, errors, warnings };

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