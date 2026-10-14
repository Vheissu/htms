import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleObjectTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const name = element.getAttribute('name');

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'OBJECT tag requires a name attribute',
        tag: 'OBJECT',
      });
      return { code: '', errors, warnings };
    }

    // Validate object name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      errors.push(...nameErrors.map((error) => ({ ...error, tag: 'OBJECT' })));
      return { code: '', errors, warnings };
    }

    // Collect object properties from child elements
    const properties: string[] = [];

    for (const child of Array.from(element.children)) {
      if (child.tagName.toLowerCase() === 'property') {
        const propName = child.getAttribute('name');
        const propValue =
          child.getAttribute('value') || child.textContent?.trim() || '';

        if (!propName) {
          warnings.push({
            message: 'Property element missing name attribute - skipped',
            tag: 'OBJECT',
          });
          continue;
        }

        // Validate property name
        const propNameErrors =
          SecurityValidator.validateJavaScriptIdentifier(propName);
        if (propNameErrors.length > 0) {
          errors.push(
            ...propNameErrors.map((error) => ({
              ...error,
              tag: 'OBJECT',
              message: `Invalid property name: ${propName}`,
            }))
          );
          continue;
        }

        if (!propValue) {
          warnings.push({
            message: `Empty property value for: ${propName}`,
            tag: 'OBJECT',
          });
          properties.push(`${propName}: undefined`);
          continue;
        }

        // Security validation of property value
        const valueErrors = SecurityValidator.validateContent(propValue);
        if (valueErrors.length > 0) {
          errors.push(
            ...valueErrors.map((error) => ({ ...error, tag: 'OBJECT' }))
          );
          if (options.strictMode) {
            continue;
          }
        }

        // Process different property value types
        let processedValue: string;

        // Check if it's a number
        if (SecurityValidator.isNumericLiteral(propValue)) {
          const numErrors = SecurityValidator.validateNumericValue(propValue);
          if (numErrors.length > 0) {
            errors.push(
              ...numErrors.map((error) => ({ ...error, tag: 'OBJECT' }))
            );
            continue;
          }
          processedValue = propValue;
        }
        // Check if it's a boolean
        else if (propValue === 'true' || propValue === 'false') {
          processedValue = propValue;
        }
        // Check if it's null
        else if (propValue === 'null') {
          processedValue = 'null';
        }
        // Check if it's an array literal
        else if (propValue.startsWith('[') && propValue.endsWith(']')) {
          try {
            const parsed = JSON.parse(propValue);
            if (!Array.isArray(parsed)) {
              errors.push({
                type: 'validation',
                message: `Invalid array literal for property: ${propName}`,
                tag: 'OBJECT',
              });
              continue;
            }

            // Validate array elements
            for (const item of parsed) {
              if (typeof item === 'string') {
                const itemErrors = SecurityValidator.validateContent(item);
                if (itemErrors.length > 0) {
                  errors.push(
                    ...itemErrors.map((error) => ({ ...error, tag: 'OBJECT' }))
                  );
                  if (options.strictMode) {
                    break;
                  }
                }
              }
            }

            processedValue = JSON.stringify(parsed);
          } catch {
            errors.push({
              type: 'validation',
              message: `Invalid JSON array for property: ${propName}`,
              tag: 'OBJECT',
            });
            continue;
          }
        }
        // Check if it's an object literal
        else if (propValue.startsWith('{') && propValue.endsWith('}')) {
          try {
            const parsed = JSON.parse(propValue);
            if (
              typeof parsed !== 'object' ||
              Array.isArray(parsed) ||
              parsed === null
            ) {
              errors.push({
                type: 'validation',
                message: `Invalid object literal for property: ${propName}`,
                tag: 'OBJECT',
              });
              continue;
            }

            // Validate nested object properties
            for (const [key, val] of Object.entries(parsed)) {
              const keyErrors =
                SecurityValidator.validateJavaScriptIdentifier(key);
              if (keyErrors.length > 0) {
                errors.push(
                  ...keyErrors.map((error) => ({ ...error, tag: 'OBJECT' }))
                );
                continue;
              }

              if (typeof val === 'string') {
                const valErrors = SecurityValidator.validateContent(val);
                if (valErrors.length > 0) {
                  errors.push(
                    ...valErrors.map((error) => ({ ...error, tag: 'OBJECT' }))
                  );
                  if (options.strictMode) {
                    break;
                  }
                }
              }
            }

            processedValue = JSON.stringify(parsed);
          } catch {
            errors.push({
              type: 'validation',
              message: `Invalid JSON object for property: ${propName}`,
              tag: 'OBJECT',
            });
            continue;
          }
        }
        // Check if it's a variable reference
        // (inside a component only when it names a field; otherwise text)
        else if (
          /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(propValue) &&
          (handlerScope(options).isReference?.(propValue) ?? true)
        ) {
          const varErrors =
            SecurityValidator.validateJavaScriptIdentifier(propValue);
          if (varErrors.length > 0) {
            errors.push(
              ...varErrors.map((error) => ({ ...error, tag: 'OBJECT' }))
            );
            continue;
          }
          processedValue = handlerScope(options).expression(propValue);
        }
        // Treat as string literal (escape and quote)
        else {
          processedValue = SecurityValidator.jsStringLiteral(propValue);
        }

        properties.push(`${propName}: ${processedValue}`);
      } else {
        warnings.push({
          message: `Unexpected child element in OBJECT: ${child.tagName}`,
          tag: 'OBJECT',
        });
      }
    }

    const objectLiteral = `{${properties.join(', ')}}`;
    if (options.componentContext) {
      // Inside a component the literal declares component state, like <var>.
      return {
        code: '',
        errors,
        warnings,
        component: {
          directives: [
            { kind: 'state', mode: 'init', path: [name], value: objectLiteral },
          ],
        },
      };
    }

    const code = `const ${name} = ${objectLiteral};`;

    CompilerLogger.logDebug('Generated object declaration', {
      name,
      propertyCount: properties.length,
      generatedCode: code,
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Object tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'OBJECT',
    };

    CompilerLogger.logCompilerError('Object tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
