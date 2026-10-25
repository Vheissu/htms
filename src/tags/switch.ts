import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { DirectiveNode, SwitchDirective, TemplateNode } from '../component/ir';
import { collectBranchContent } from './branch-content';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleSwitchTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, report, empty } =
    handlerDiagnostics('SWITCH');

  try {
    const exprAttr =
      element.getAttribute('expr') || element.getAttribute('expression');
    const variable = element.getAttribute('variable');
    const expression = exprAttr || variable;

    if (!expression) {
      return fail('SWITCH tag requires a variable or expr attribute');
    }

    if (exprAttr) {
      const exprErrors = SecurityValidator.validateContent(expression);
      if (exprErrors.length > 0) {
        report(exprErrors);
        if (options.strictMode) {
          return empty();
        }
      }
    } else if (variable) {
      const parts = variable.split('.');
      if (parts[0] === 'this') {
        parts.shift();
      }
      let invalid = false;
      for (const part of parts) {
        const varErrors = SecurityValidator.validateJavaScriptIdentifier(part);
        if (varErrors.length > 0) {
          errors.push(
            ...varErrors.map((error) => ({
              ...error,
              tag: 'SWITCH',
              message: `Invalid variable name: ${variable}`,
            }))
          );
          invalid = true;
          break;
        }
      }
      if (invalid) {
        return empty();
      }
    }

    // Process case and default elements
    const cases: string[] = [];
    const componentCases: Array<{
      value: string;
      template: TemplateNode[];
      directives?: DirectiveNode[];
    }> = [];
    let defaultCase = '';
    let hasDefault = false;
    let defaultTemplates: TemplateNode[] | null = null;
    let defaultDirectives: DirectiveNode[] = [];

    for (const child of Array.from(element.children)) {
      const tagName = child.tagName.toLowerCase();

      if (tagName === 'case') {
        const caseValue = child.getAttribute('value');
        if (!caseValue) {
          warnings.push({
            message: 'CASE element missing value attribute - skipped',
            tag: 'SWITCH',
          });
          continue;
        }

        // Security validation of case value
        const valueErrors = SecurityValidator.validateContent(caseValue);
        if (valueErrors.length > 0) {
          report(valueErrors);
          if (options.strictMode) {
            continue;
          }
        }

        // Validate case value format - must be string, number, or boolean
        let processedValue: string;
        if (SecurityValidator.isNumericLiteral(caseValue)) {
          // Numeric value
          const numErrors = SecurityValidator.validateNumericValue(caseValue);
          if (numErrors.length > 0) {
            report(numErrors);
            continue;
          }
          processedValue = caseValue;
        } else if (caseValue === 'true' || caseValue === 'false') {
          // Boolean value
          processedValue = caseValue;
        } else {
          // String value (escape and quote)
          processedValue = SecurityValidator.jsStringLiteral(caseValue);
        }

        // Build case body from raw text (legacy) and child nodes
        const {
          code: innerCaseCode,
          templates: caseTemplates,
          directives: caseDirectives,
        } = collectBranchContent(
          child,
          options,
          'SWITCH',
          errors,
          warnings,
          true
        );

        const caseCode = innerCaseCode.trim()
          ? `case ${processedValue}: {\n    try {\n${innerCaseCode
              .split('\n')
              .filter(Boolean)
              .map((l) => '      ' + l)
              .join(
                '\n'
              )}\n    } catch (error) {\n      console.error('Case execution error:', error);\n    }\n    break;\n  }`
          : `case ${processedValue}: {\n    // Empty case\n    break;\n  }`;

        cases.push(caseCode);

        componentCases.push({
          value: processedValue,
          template: caseTemplates,
          directives: caseDirectives.length > 0 ? caseDirectives : undefined,
        });

        // No sanitization of code applied; content validated above
      } else if (tagName === 'default') {
        if (hasDefault) {
          warnings.push({
            message: 'Multiple DEFAULT elements found - using first one',
            tag: 'SWITCH',
          });
          continue;
        }

        hasDefault = true;
        const {
          code: defaultInner,
          templates,
          directives,
        } = collectBranchContent(
          child,
          options,
          'SWITCH',
          errors,
          warnings,
          true
        );

        if (defaultInner.trim()) {
          defaultCase = `default: {\n    try {\n${defaultInner
            .split('\n')
            .filter(Boolean)
            .map((l) => '      ' + l)
            .join(
              '\n'
            )}\n    } catch (error) {\n      console.error('Default case execution error:', error);\n    }\n    break;\n  }`;
        } else {
          defaultCase =
            'default: {\n    // Empty default case\n    break;\n  }';
        }

        defaultTemplates = templates;
        defaultDirectives = directives;
      } else {
        warnings.push({
          message: `Unexpected child element in SWITCH: ${child.tagName}`,
          tag: 'SWITCH',
        });
      }
    }

    if (cases.length === 0) {
      warnings.push({
        message: 'SWITCH has no CASE elements',
        tag: 'SWITCH',
      });
    }

    // Generate switch statement
    let code = `switch (${expression}) {\n`;

    for (const caseCode of cases) {
      code += `  ${caseCode.replace(/\n/g, '\n  ')}\n`;
    }

    if (hasDefault) {
      code += `  ${defaultCase.replace(/\n/g, '\n  ')}\n`;
    }

    code += '}';

    CompilerLogger.logDebug('Generated switch statement', {
      expression,
      caseCount: cases.length,
      hasDefault,
      codeLength: code.length,
    });

    let switchDirective: SwitchDirective | undefined;
    if (componentCases.length > 0 || defaultTemplates) {
      switchDirective = {
        kind: 'switch',
        expression: handlerScope(options).expression(expression),
        cases: componentCases,
        defaultCase: defaultTemplates
          ? {
              template: defaultTemplates,
              directives:
                defaultDirectives.length > 0 ? defaultDirectives : undefined,
            }
          : undefined,
      };
    }

    return {
      code,
      errors,
      warnings,
      component: switchDirective
        ? { directives: [switchDirective] }
        : undefined,
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Switch tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'SWITCH',
    };

    CompilerLogger.logCompilerError('Switch tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
