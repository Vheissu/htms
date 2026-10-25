import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

// Whitelist of allowed function names for security
const ALLOWED_FUNCTIONS = new Set([
  'console.log',
  'console.info',
  'console.warn',
  'console.error',
  'console.debug',
  'Math.max',
  'Math.min',
  'Math.abs',
  'Math.floor',
  'Math.ceil',
  'Math.round',
  'Math.random',
  'Math.sqrt',
  'Math.pow',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Date.now',
  'JSON.stringify',
  'JSON.parse',
  'Array.isArray',
  'Object.keys',
  'Object.values',
  'Object.entries',
]);

export const handleCallTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith, report, empty } =
    handlerDiagnostics('CALL');

  try {
    const functionName = element.getAttribute('function');
    const args = element.getAttribute('args') || '';

    if (!functionName) {
      return fail('CALL tag requires a function attribute');
    }

    // Validate function name
    const functionErrors = SecurityValidator.validateJavaScriptIdentifier(
      functionName.split('.')[0]
    );
    if (functionErrors.length > 0 && !functionName.includes('.')) {
      return failWith(functionErrors);
    }

    // Security check - only allow whitelisted functions in strict mode
    if (
      options.strictMode &&
      !ALLOWED_FUNCTIONS.has(functionName) &&
      !options.componentFields?.has(functionName.split('.')[0])
    ) {
      return fail(
        `Function not in whitelist: ${functionName}. Allowed functions: ${Array.from(ALLOWED_FUNCTIONS).join(', ')}`,
        'security'
      );
    }

    // Validate function name format
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(functionName)) {
      return fail(`Invalid function name format: ${functionName}`);
    }

    // Security validation of arguments
    if (args) {
      const argErrors = SecurityValidator.validateContent(args);
      if (argErrors.length > 0) {
        report(argErrors);
        if (options.strictMode) {
          return empty();
        }
      }

      // Additional argument validation - no eval, Function, etc.
      if (
        /eval\s*\(|Function\s*\(|setTimeout\s*\(|setInterval\s*\(/i.test(args)
      ) {
        return fail('Dangerous functions not allowed in arguments', 'security');
      }
    }

    // Parse and validate arguments safely
    let validatedArgs = '';
    if (args.trim()) {
      try {
        // Basic argument parsing - split by comma and validate each
        const argList = args.split(',').map((arg) => arg.trim());
        const validatedArgList: string[] = [];

        for (const arg of argList) {
          // Check if it's a string literal
          if (
            (arg.startsWith('"') && arg.endsWith('"')) ||
            (arg.startsWith("'") && arg.endsWith("'"))
          ) {
            const stringContent = arg.slice(1, -1);
            validatedArgList.push(
              SecurityValidator.jsStringLiteral(stringContent)
            );
          }
          // Check if it's a number
          else if (SecurityValidator.isNumericLiteral(arg)) {
            const numErrors = SecurityValidator.validateNumericValue(arg);
            if (numErrors.length > 0) {
              return failWith(numErrors);
            }
            validatedArgList.push(arg);
          }
          // Check if it's a boolean
          else if (arg === 'true' || arg === 'false') {
            validatedArgList.push(arg);
          }
          // Check if it's a variable name
          else if (SecurityValidator.isJavaScriptPath(arg)) {
            const parts = arg.split('.');
            for (const part of parts) {
              const varErrors =
                SecurityValidator.validateJavaScriptIdentifier(part);
              if (varErrors.length > 0) {
                return failWith(varErrors);
              }
            }
            validatedArgList.push(arg);
          } else {
            return fail(`Invalid argument format: ${arg}`);
          }
        }

        validatedArgs = validatedArgList.join(', ');
      } catch {
        return fail(`Failed to parse arguments: ${args}`);
      }
    }

    // Inside a component, `function="save"` calls the component method and
    // bare arguments read component fields.
    const callExpression = handlerScope(options).expression(
      `${functionName}(${validatedArgs})`
    );

    // Generate safe function call with try-catch
    const code = `
      try {
        ${callExpression};
      } catch (error) {
        console.error(${JSON.stringify(`Function call failed: ${functionName}`)}, error);
      }
    `;

    const callsComponentMember =
      options.componentFields?.has(functionName.split('.')[0]) ?? false;
    if (!ALLOWED_FUNCTIONS.has(functionName) && !callsComponentMember) {
      warnings.push({
        message: `Function call to ${functionName} may pose security risks`,
        tag: 'CALL',
      });

      CompilerLogger.logSecurityIssue('Potentially dangerous function call', {
        functionName,
        args: validatedArgs,
      });
    }

    CompilerLogger.logDebug('Generated function call', {
      functionName,
      args: validatedArgs,
      isWhitelisted: ALLOWED_FUNCTIONS.has(functionName),
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Call tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'CALL',
    };

    CompilerLogger.logCompilerError('Call tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
