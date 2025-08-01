import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleSwitchTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const variable = element.getAttribute('variable');

    if (!variable) {
      errors.push({
        type: 'validation',
        message: 'SWITCH tag requires a variable attribute',
        tag: 'SWITCH'
      });
      return { code: '', errors, warnings };
    }

    // Validate variable name
    const varErrors = SecurityValidator.validateJavaScriptIdentifier(variable);
    if (varErrors.length > 0) {
      errors.push(...varErrors.map(error => ({ 
        ...error, 
        tag: 'SWITCH',
        message: `Invalid variable name: ${variable}` 
      })));
      return { code: '', errors, warnings };
    }

    // Process case and default elements
    const cases: string[] = [];
    let defaultCase = '';
    let hasDefault = false;

    for (const child of Array.from(element.children)) {
      const tagName = child.tagName.toLowerCase();
      
      if (tagName === 'case') {
        const caseValue = child.getAttribute('value');
        const caseBody = child.textContent?.trim() || '';
        
        if (!caseValue) {
          warnings.push({
            message: 'CASE element missing value attribute - skipped',
            tag: 'SWITCH'
          });
          continue;
        }

        // Security validation of case value
        const valueErrors = SecurityValidator.validateContent(caseValue);
        if (valueErrors.length > 0) {
          errors.push(...valueErrors.map(error => ({ ...error, tag: 'SWITCH' })));
          if (options.strictMode) {
            continue;
          }
        }

        // Validate case value format - must be string, number, or boolean
        let processedValue: string;
        if (/^-?\d+(\.\d+)?$/.test(caseValue)) {
          // Numeric value
          const numErrors = SecurityValidator.validateNumericValue(caseValue);
          if (numErrors.length > 0) {
            errors.push(...numErrors.map(error => ({ ...error, tag: 'SWITCH' })));
            continue;
          }
          processedValue = caseValue;
        } else if (caseValue === 'true' || caseValue === 'false') {
          // Boolean value
          processedValue = caseValue;
        } else {
          // String value (escape and quote)
          const escapedValue = SecurityValidator.escapeForTemplate(caseValue);
          processedValue = `"${escapedValue}"`;
        }

        // Security validation of case body
        let sanitizedBody = '';
        if (caseBody) {
          const bodyErrors = SecurityValidator.validateContent(caseBody);
          if (bodyErrors.length > 0) {
            errors.push(...bodyErrors.map(error => ({ ...error, tag: 'SWITCH' })));
            if (options.strictMode) {
              continue;
            }
          }
          sanitizedBody = SecurityValidator.sanitizeString(caseBody);
        }

        const caseCode = sanitizedBody ? 
          `case ${processedValue}: {\n    try {\n      ${sanitizedBody}\n    } catch (error) {\n      console.error('Case execution error:', error);\n    }\n    break;\n  }` :
          `case ${processedValue}: {\n    // Empty case\n    break;\n  }`;
        
        cases.push(caseCode);

        if (caseBody && caseBody !== sanitizedBody) {
          warnings.push({
            message: `Case body sanitized for value: ${caseValue}`,
            tag: 'SWITCH'
          });
        }

      } else if (tagName === 'default') {
        if (hasDefault) {
          warnings.push({
            message: 'Multiple DEFAULT elements found - using first one',
            tag: 'SWITCH'
          });
          continue;
        }

        hasDefault = true;
        const defaultBody = child.textContent?.trim() || '';
        
        if (defaultBody) {
          const bodyErrors = SecurityValidator.validateContent(defaultBody);
          if (bodyErrors.length > 0) {
            errors.push(...bodyErrors.map(error => ({ ...error, tag: 'SWITCH' })));
            if (options.strictMode) {
              continue;
            }
          }
          
          const sanitizedDefaultBody = SecurityValidator.sanitizeString(defaultBody);
          defaultCase = `default: {\n    try {\n      ${sanitizedDefaultBody}\n    } catch (error) {\n      console.error('Default case execution error:', error);\n    }\n    break;\n  }`;
          
          if (defaultBody !== sanitizedDefaultBody) {
            warnings.push({
              message: 'Default case body sanitized for security',
              tag: 'SWITCH'
            });
          }
        } else {
          defaultCase = 'default: {\n    // Empty default case\n    break;\n  }';
        }

      } else {
        warnings.push({
          message: `Unexpected child element in SWITCH: ${child.tagName}`,
          tag: 'SWITCH'
        });
      }
    }

    if (cases.length === 0) {
      warnings.push({
        message: 'SWITCH has no CASE elements',
        tag: 'SWITCH'
      });
    }

    // Generate switch statement
    let code = `switch (${variable}) {\n`;
    
    for (const caseCode of cases) {
      code += `  ${caseCode.replace(/\n/g, '\n  ')}\n`;
    }
    
    if (hasDefault) {
      code += `  ${defaultCase.replace(/\n/g, '\n  ')}\n`;
    }
    
    code += '}';

    CompilerLogger.logDebug('Generated switch statement', {
      variable,
      caseCount: cases.length,
      hasDefault,
      codeLength: code.length
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Switch tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'SWITCH'
    };
    
    CompilerLogger.logCompilerError('Switch tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};