import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleArrayTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const name = element.getAttribute('name');

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'ARRAY tag requires a name attribute',
        tag: 'ARRAY'
      });
      return { code: '', errors, warnings };
    }

    // Validate array name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      errors.push(...nameErrors.map(error => ({ ...error, tag: 'ARRAY' })));
      return { code: '', errors, warnings };
    }

    // Collect array values from child elements
    const values: string[] = [];
    
    for (const child of Array.from(element.children)) {
      if (child.tagName.toLowerCase() === 'value') {
        const valueContent = child.textContent?.trim() || '';
        
        if (!valueContent) {
          warnings.push({
            message: 'Empty array value ignored',
            tag: 'ARRAY'
          });
          continue;
        }

        // Security validation of value content
        const contentErrors = SecurityValidator.validateContent(valueContent);
        if (contentErrors.length > 0) {
          errors.push(...contentErrors.map(error => ({ ...error, tag: 'ARRAY' })));
          if (options.strictMode) {
            continue;
          }
        }

        // Process different value types
        let processedValue: string;
        
        // Check if it's a number
        if (/^-?\d+(\.\d+)?$/.test(valueContent)) {
          const numErrors = SecurityValidator.validateNumericValue(valueContent);
          if (numErrors.length > 0) {
            errors.push(...numErrors.map(error => ({ ...error, tag: 'ARRAY' })));
            continue;
          }
          processedValue = valueContent;
        }
        // Check if it's a boolean
        else if (valueContent === 'true' || valueContent === 'false') {
          processedValue = valueContent;
        }
        // Check if it's null
        else if (valueContent === 'null') {
          processedValue = 'null';
        }
        // Treat as string (escape and quote)
        else {
          const escapedValue = SecurityValidator.escapeForTemplate(valueContent);
          processedValue = `"${escapedValue}"`;
        }
        
        values.push(processedValue);
      } else {
        warnings.push({
          message: `Unexpected child element in ARRAY: ${child.tagName}`,
          tag: 'ARRAY'
        });
      }
    }

    const arrayLiteral = `[${values.join(', ')}]`;
    const code = `const ${name} = ${arrayLiteral};`;

    CompilerLogger.logDebug('Generated array declaration', {
      name,
      valueCount: values.length,
      generatedCode: code
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Array tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'ARRAY'
    };
    
    CompilerLogger.logCompilerError('Array tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};