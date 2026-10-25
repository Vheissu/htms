import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleArrayTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith, report } =
    handlerDiagnostics('ARRAY');

  try {
    const name = element.getAttribute('name');

    if (!name) {
      return fail('ARRAY tag requires a name attribute');
    }

    // Validate array name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      return failWith(nameErrors);
    }

    // Collect array values from child elements
    const values: string[] = [];

    for (const child of Array.from(element.children)) {
      if (child.tagName.toLowerCase() === 'value') {
        const valueContent = child.textContent?.trim() || '';

        if (!valueContent) {
          warnings.push({
            message: 'Empty array value ignored',
            tag: 'ARRAY',
          });
          continue;
        }

        // Security validation of value content
        const contentErrors = SecurityValidator.validateContent(valueContent);
        if (contentErrors.length > 0) {
          report(contentErrors);
          if (options.strictMode) {
            continue;
          }
        }

        // Process different value types
        let processedValue: string;

        // Check if it's a number
        if (SecurityValidator.isNumericLiteral(valueContent)) {
          const numErrors =
            SecurityValidator.validateNumericValue(valueContent);
          if (numErrors.length > 0) {
            report(numErrors);
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
          processedValue = SecurityValidator.jsStringLiteral(valueContent);
        }

        values.push(processedValue);
      } else {
        warnings.push({
          message: `Unexpected child element in ARRAY: ${child.tagName}`,
          tag: 'ARRAY',
        });
      }
    }

    const arrayLiteral = `[${values.join(', ')}]`;
    if (options.componentContext) {
      // Inside a component the literal declares component state, like <var>.
      return {
        code: '',
        errors,
        warnings,
        component: {
          directives: [
            { kind: 'state', mode: 'init', path: [name], value: arrayLiteral },
          ],
        },
      };
    }

    const code = `const ${name} = ${arrayLiteral};`;

    CompilerLogger.logDebug('Generated array declaration', {
      name,
      valueCount: values.length,
      generatedCode: code,
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Array tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'ARRAY',
    };

    CompilerLogger.logCompilerError('Array tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
