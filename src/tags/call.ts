import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

// Whitelist of allowed function names for security
const ALLOWED_FUNCTIONS = new Set([
  'console.log', 'console.info', 'console.warn', 'console.error', 'console.debug',
  'Math.max', 'Math.min', 'Math.abs', 'Math.floor', 'Math.ceil', 'Math.round',
  'Math.random', 'Math.sqrt', 'Math.pow',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Date.now', 'JSON.stringify', 'JSON.parse',
  'Array.isArray', 'Object.keys', 'Object.values', 'Object.entries'
]);

export const handleCallTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const functionName = element.getAttribute('function');
    const args = element.getAttribute('args') || '';

    if (!functionName) {
      errors.push({
        type: 'validation',
        message: 'CALL tag requires a function attribute',
        tag: 'CALL'
      });
      return { code: '', errors, warnings };
    }

    // Validate function name
    const functionErrors = SecurityValidator.validateJavaScriptIdentifier(functionName.split('.')[0]);
    if (functionErrors.length > 0 && !functionName.includes('.')) {
      errors.push(...functionErrors.map(error => ({ ...error, tag: 'CALL' })));
      return { code: '', errors, warnings };
    }

    // Security check - only allow whitelisted functions in strict mode
    if (options.strictMode && !ALLOWED_FUNCTIONS.has(functionName)) {
      errors.push({
        type: 'security',
        message: `Function not in whitelist: ${functionName}. Allowed functions: ${Array.from(ALLOWED_FUNCTIONS).join(', ')}`,
        tag: 'CALL'
      });
      return { code: '', errors, warnings };
    }

    // Validate function name format
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(functionName)) {
      errors.push({
        type: 'validation',
        message: `Invalid function name format: ${functionName}`,
        tag: 'CALL'
      });
      return { code: '', errors, warnings };
    }

    // Security validation of arguments
    if (args) {
      const argErrors = SecurityValidator.validateContent(args);
      if (argErrors.length > 0) {
        errors.push(...argErrors.map(error => ({ ...error, tag: 'CALL' })));
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }

      // Additional argument validation - no eval, Function, etc.
      if (/eval\s*\(|Function\s*\(|setTimeout\s*\(|setInterval\s*\(/i.test(args)) {
        errors.push({
          type: 'security',
          message: 'Dangerous functions not allowed in arguments',
          tag: 'CALL'
        });
        return { code: '', errors, warnings };
      }
    }

    // Parse and validate arguments safely
    let validatedArgs = '';
    if (args.trim()) {
      try {
        // Basic argument parsing - split by comma and validate each
        const argList = args.split(',').map(arg => arg.trim());
        const validatedArgList: string[] = [];

        for (const arg of argList) {
          // Check if it's a string literal
          if ((arg.startsWith('"') && arg.endsWith('"')) || 
              (arg.startsWith("'") && arg.endsWith("'"))) {
            const stringContent = arg.slice(1, -1);
            const escapedContent = SecurityValidator.escapeForTemplate(stringContent);
            validatedArgList.push(`"${escapedContent}"`);
          }
          // Check if it's a number
          else if (/^-?\d+(\.\d+)?$/.test(arg)) {
            const numErrors = SecurityValidator.validateNumericValue(arg);
            if (numErrors.length > 0) {
              errors.push(...numErrors.map(error => ({ ...error, tag: 'CALL' })));
              return { code: '', errors, warnings };
            }
            validatedArgList.push(arg);
          }
          // Check if it's a boolean
          else if (arg === 'true' || arg === 'false') {
            validatedArgList.push(arg);
          }
          // Check if it's a variable name
          else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(arg)) {
            const parts = arg.split('.');
            for (const part of parts) {
              const varErrors = SecurityValidator.validateJavaScriptIdentifier(part);
              if (varErrors.length > 0) {
                errors.push(...varErrors.map(error => ({ ...error, tag: 'CALL' })));
                return { code: '', errors, warnings };
              }
            }
            validatedArgList.push(arg);
          }
          else {
            errors.push({
              type: 'validation',
              message: `Invalid argument format: ${arg}`,
              tag: 'CALL'
            });
            return { code: '', errors, warnings };
          }
        }

        validatedArgs = validatedArgList.join(', ');
      } catch (error) {
        errors.push({
          type: 'validation',
          message: `Failed to parse arguments: ${args}`,
          tag: 'CALL'
        });
        return { code: '', errors, warnings };
      }
    }

    // Generate safe function call with try-catch
    const code = `
      try {
        ${functionName}(${validatedArgs});
      } catch (error) {
        console.error('Function call failed: ${functionName}', error);
      }
    `;

    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      warnings.push({
        message: `Function call to ${functionName} may pose security risks`,
        tag: 'CALL'
      });
      
      CompilerLogger.logSecurityIssue('Potentially dangerous function call', {
        functionName,
        args: validatedArgs
      });
    }

    CompilerLogger.logDebug('Generated function call', {
      functionName,
      args: validatedArgs,
      isWhitelisted: ALLOWED_FUNCTIONS.has(functionName)
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Call tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'CALL'
    };
    
    CompilerLogger.logCompilerError('Call tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};
