import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleIfElseTags: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    if (element.tagName.toUpperCase() !== 'IF') {
      errors.push({
        type: 'validation',
        message: 'This handler only processes IF tags',
        tag: element.tagName
      });
      return { code: '', errors, warnings };
    }

    const condition = element.getAttribute('condition');
    const ifBody = element.textContent?.trim() || '';

    if (!condition) {
      errors.push({
        type: 'validation',
        message: 'IF tag requires a condition attribute',
        tag: 'IF'
      });
      return { code: '', errors, warnings };
    }

    // Security validation of condition
    const conditionErrors = SecurityValidator.validateContent(condition);
    if (conditionErrors.length > 0) {
      errors.push(...conditionErrors.map(error => ({ ...error, tag: 'IF' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    // Validate condition format - must be a safe boolean expression
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(\s*[<>=!]+\s*[a-zA-Z0-9_$'".\s]*)?(\s*[&|]{2}\s*[a-zA-Z_$][a-zA-Z0-9_$]*(\s*[<>=!]+\s*[a-zA-Z0-9_$'".\s]*)?)*$/.test(condition.trim())) {
      warnings.push({
        message: 'Complex condition detected - may pose security risks',
        tag: 'IF'
      });
      
      if (options.strictMode) {
        errors.push({
          type: 'security',
          message: 'Complex conditions not allowed in strict mode',
          tag: 'IF'
        });
        return { code: '', errors, warnings };
      }
    }

    // Security validation of if body
    let sanitizedIfBody = '';
    if (ifBody) {
      const bodyErrors = SecurityValidator.validateContent(ifBody);
      if (bodyErrors.length > 0) {
        errors.push(...bodyErrors.map(error => ({ ...error, tag: 'IF' })));
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }
      sanitizedIfBody = SecurityValidator.sanitizeString(ifBody);
    }

    // Check for corresponding ELSE tag
    let elseBody = '';
    let hasElse = false;
    
    // Look for next sibling ELSE element
    let nextSibling = element.nextElementSibling;
    if (nextSibling && nextSibling.tagName.toUpperCase() === 'ELSE') {
      hasElse = true;
      const elseContent = nextSibling.textContent?.trim() || '';
      
      if (elseContent) {
        const elseErrors = SecurityValidator.validateContent(elseContent);
        if (elseErrors.length > 0) {
          errors.push(...elseErrors.map(error => ({ ...error, tag: 'ELSE' })));
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
        }
        elseBody = SecurityValidator.sanitizeString(elseContent);
      }
    }

    // Sanitize condition
    const sanitizedCondition = SecurityValidator.sanitizeString(condition);

    // Generate safe conditional code
    let code = `if (${sanitizedCondition}) {\n`;
    
    if (sanitizedIfBody) {
      code += `  try {\n    ${sanitizedIfBody}\n  } catch (error) {\n    console.error('IF block execution error:', error);\n  }\n`;
    } else {
      code += '  // Empty if block\n';
    }
    
    code += '}';
    
    if (hasElse) {
      code += ' else {\n';
      if (elseBody) {
        code += `  try {\n    ${elseBody}\n  } catch (error) {\n    console.error('ELSE block execution error:', error);\n  }\n`;
      } else {
        code += '  // Empty else block\n';
      }
      code += '}';
    }

    // Check for sanitization warnings
    if (condition !== sanitizedCondition) {
      warnings.push({
        message: 'Condition was sanitized for security',
        tag: 'IF'
      });
    }

    if (ifBody && ifBody !== sanitizedIfBody) {
      warnings.push({
        message: 'IF body was sanitized for security',
        tag: 'IF'
      });
    }

    if (elseBody && nextSibling?.textContent !== elseBody) {
      warnings.push({
        message: 'ELSE body was sanitized for security',
        tag: 'ELSE'
      });
    }

    CompilerLogger.logDebug('Generated conditional statement', {
      condition: sanitizedCondition,
      hasIfBody: !!sanitizedIfBody,
      hasElse,
      hasElseBody: !!elseBody,
      codeLength: code.length
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `If-else tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'IF'
    };
    
    CompilerLogger.logCompilerError('If-else tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};