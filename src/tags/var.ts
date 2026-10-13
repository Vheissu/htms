import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handlerScope } from '../component/scope';
import { parseJsonLiteral, valueAttributeToExpression } from '../utils/values';

export const handleVarTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';
    const mutable =
      (element.getAttribute('mutable') || 'false').toLowerCase() === 'true';

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'VAR tag requires a name attribute',
        tag: 'VAR',
      });
      return { code: '', errors, warnings };
    }

    // Validate variable name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      errors.push(...nameErrors.map((error) => ({ ...error, tag: 'VAR' })));
      return { code: '', errors, warnings };
    }

    // Security validation of value
    const valueErrors = SecurityValidator.validateContent(value);
    if (valueErrors.length > 0) {
      errors.push(...valueErrors.map((error) => ({ ...error, tag: 'VAR' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    const trimmedValue = value.trim();
    const looksLikeJson =
      (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) ||
      (trimmedValue.startsWith('{') && trimmedValue.endsWith('}'));
    if (looksLikeJson && parseJsonLiteral(trimmedValue) === null) {
      errors.push({
        type: 'validation',
        message: `Invalid JSON ${trimmedValue.startsWith('[') ? 'array' : 'object'} literal`,
        tag: 'VAR',
        hint: 'Array and object values must be valid JSON, e.g. value=\'[{"id": 1}]\'.',
      });
      return { code: '', errors, warnings };
    }

    if (
      SecurityValidator.isNumericLiteral(trimmedValue) &&
      SecurityValidator.validateNumericValue(trimmedValue).length > 0
    ) {
      errors.push(
        ...SecurityValidator.validateNumericValue(trimmedValue).map(
          (error) => ({ ...error, tag: 'VAR' })
        )
      );
      return { code: '', errors, warnings };
    }

    const processedValue = handlerScope(options).expression(
      valueAttributeToExpression(value, {
        isReference: handlerScope(options).isReference,
      })
    );

    const decl = mutable ? 'let' : 'const';
    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext
      ? ''
      : `${decl} ${name} = ${processedValue};`;

    CompilerLogger.logDebug('Generated variable declaration', {
      name,
      originalValue: value,
      processedValue,
      generatedCode: code,
      mutable,
    });

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'init',
      path: name.split('.'),
      value: processedValue,
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
    const runtimeError = {
      type: 'runtime' as const,
      message: `Var tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'VAR',
    };

    CompilerLogger.logCompilerError('Var tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
