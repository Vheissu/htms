import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleRepeatTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const variable = element.getAttribute('variable');
    const count = element.getAttribute('count');
    const body = element.textContent?.trim() || '';

    // Validate that we have either variable or count
    if (!variable && !count) {
      errors.push({
        type: 'validation',
        message: 'REPEAT tag requires either variable (for array iteration) or count (for numeric loop)',
        tag: 'REPEAT'
      });
      return { code: '', errors, warnings };
    }

    // Both variable and count cannot be specified together
    if (variable && count) {
      errors.push({
        type: 'validation',
        message: 'REPEAT tag cannot have both variable and count attributes',
        tag: 'REPEAT'
      });
      return { code: '', errors, warnings };
    }

    let loopCode = '';
    let loopVariable = 'item'; // default loop variable

    if (variable) {
      // Array iteration mode
      const varErrors = SecurityValidator.validateJavaScriptIdentifier(variable);
      if (varErrors.length > 0) {
        errors.push(...varErrors.map(error => ({ 
          ...error, 
          tag: 'REPEAT',
          message: `Invalid variable name: ${variable}` 
        })));
        return { code: '', errors, warnings };
      }

      loopCode = `for (const ${loopVariable} of ${variable}) {`;
      
    } else if (count) {
      // Numeric iteration mode
      const countErrors = SecurityValidator.validateNumericValue(count);
      if (countErrors.length > 0) {
        errors.push(...countErrors.map(error => ({ ...error, tag: 'REPEAT' })));
        return { code: '', errors, warnings };
      }

      const countNum = parseInt(count);
      if (countNum < 0 || countNum > 10000) {
        errors.push({
          type: 'validation',
          message: `Count must be between 0 and 10000, got: ${countNum}`,
          tag: 'REPEAT'
        });
        return { code: '', errors, warnings };
      }

      if (countNum > 1000) {
        warnings.push({
          message: `Large loop count (${countNum}) may impact performance`,
          tag: 'REPEAT'
        });
      }

      loopVariable = 'i'; // use index for numeric loops
      loopCode = `for (let ${loopVariable} = 0; ${loopVariable} < ${countNum}; ${loopVariable}++) {`;
    }

    // Security validation of loop body
    let sanitizedBody = '';
    if (body) {
      const bodyErrors = SecurityValidator.validateContent(body);
      if (bodyErrors.length > 0) {
        errors.push(...bodyErrors.map(error => ({ ...error, tag: 'REPEAT' })));
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }
      sanitizedBody = SecurityValidator.sanitizeString(body);
    }

    // Process child elements that might reference the loop variable
    let childCode = '';
    for (const child of Array.from(element.children)) {
      const childOptions: TagHandlerOptions = {
        ...options,
        loopVariable,
        parentContext: 'loop'
      };
      
      // Import the handleElement function to process children
      const { handleElement } = require('../handlers');
      const childResult = handleElement(child, childOptions);
      
      if (childResult.errors.length > 0) {
        errors.push(...childResult.errors);
        if (options.strictMode) {
          continue;
        }
      }
      
      if (childResult.warnings.length > 0) {
        warnings.push(...childResult.warnings);
      }
      
      if (childResult.code) {
        childCode += '  ' + childResult.code.replace(/\n/g, '\n  ') + '\n';
      }
    }

    // Combine loop body and child code
    let combinedBody = '';
    if (sanitizedBody) {
      combinedBody += `  try {\n    ${sanitizedBody}\n  } catch (error) {\n    console.error('Loop body execution error:', error);\n  }\n`;
    }
    if (childCode) {
      combinedBody += childCode;
    }
    
    if (!combinedBody.trim()) {
      warnings.push({
        message: 'Empty loop body',
        tag: 'REPEAT'
      });
      combinedBody = '  // Empty loop body\n';
    }

    const code = `${loopCode}\n${combinedBody}}`;

    if (body && body !== sanitizedBody) {
      warnings.push({
        message: 'Loop body was sanitized for security',
        tag: 'REPEAT'
      });
    }

    CompilerLogger.logDebug('Generated loop', {
      type: variable ? 'array-iteration' : 'numeric-loop',
      variable: variable || `count:${count}`,
      loopVariable,
      hasBody: !!sanitizedBody,
      hasChildren: !!childCode,
      codeLength: code.length
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Repeat tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'REPEAT'
    };
    
    CompilerLogger.logCompilerError('Repeat tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};