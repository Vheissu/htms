import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { DirectiveNode, SwitchDirective, TemplateNode } from '../component/ir';
import { elementToTemplateNode, isLowerCaseTag } from '../component/template-utils';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleSwitchTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const exprAttr = element.getAttribute('expr') || element.getAttribute('expression');
    const variable = element.getAttribute('variable');
    const expression = exprAttr || variable;

    if (!expression) {
      errors.push({
        type: 'validation',
        message: 'SWITCH tag requires a variable or expr attribute',
        tag: 'SWITCH'
      });
      return { code: '', errors, warnings };
    }

    if (exprAttr) {
      const exprErrors = SecurityValidator.validateContent(expression);
      if (exprErrors.length > 0) {
        errors.push(...exprErrors.map(error => ({ ...error, tag: 'SWITCH' })));
        if (options.strictMode) {
          return { code: '', errors, warnings };
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
            ...varErrors.map(error => ({
              ...error,
              tag: 'SWITCH',
              message: `Invalid variable name: ${variable}`
            }))
          );
          invalid = true;
          break;
        }
      }
      if (invalid) {
        return { code: '', errors, warnings };
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

        // Build case body from raw text (legacy) and child nodes
        let innerCaseCode = '';
        const caseTemplates: TemplateNode[] = [];
        const caseDirectives: DirectiveNode[] = [];

        for (const node of Array.from(child.childNodes)) {
          if (node.nodeType === 3) {
            const text = node.textContent ?? '';
            if (!text.trim()) {
              continue;
            }
            const textErrors = SecurityValidator.validateContent(text);
            if (textErrors.length > 0) {
              errors.push(...textErrors.map(error => ({ ...error, tag: 'SWITCH' })));
              if (options.strictMode) {
                continue;
              }
            }
            innerCaseCode += `${text}\n`;
            caseTemplates.push({ type: 'text', textContent: SecurityValidator.sanitizeString(text) });
            continue;
          }

          const grandChild = node as Element;
          const { handleElement } = require('../handlers');
          const gcResult = handleElement(grandChild, options);
          if (gcResult.errors.length > 0) {
            errors.push(...gcResult.errors.map((e: any) => ({ ...e, tag: 'SWITCH' })));
            if (options.strictMode) {
              continue;
            }
          }
          if (gcResult.warnings.length > 0) {
            warnings.push(...gcResult.warnings);
          }
          if (gcResult.code) {
            innerCaseCode += gcResult.code + '\n';
          }

          if (gcResult.component?.template) {
            caseTemplates.push(...gcResult.component.template);
          } else if (isLowerCaseTag(grandChild)) {
            caseTemplates.push(elementToTemplateNode(grandChild));
          }

          if (gcResult.component?.directives) {
            caseDirectives.push(...gcResult.component.directives);
          } else if (gcResult.code && !isLowerCaseTag(grandChild)) {
            caseDirectives.push({ kind: 'statement', code: gcResult.code });
          }
        }

        const caseCode = innerCaseCode.trim() ? 
          `case ${processedValue}: {\n    try {\n${innerCaseCode.split('\n').filter(Boolean).map(l => '      ' + l).join('\n')}\n    } catch (error) {\n      console.error('Case execution error:', error);\n    }\n    break;\n  }` :
          `case ${processedValue}: {\n    // Empty case\n    break;\n  }`;
        
        cases.push(caseCode);

        componentCases.push({
          value: processedValue,
          template: caseTemplates,
          directives: caseDirectives.length > 0 ? caseDirectives : undefined
        });

        // No sanitization of code applied; content validated above

      } else if (tagName === 'default') {
        if (hasDefault) {
          warnings.push({
            message: 'Multiple DEFAULT elements found - using first one',
            tag: 'SWITCH'
          });
          continue;
        }

        hasDefault = true;
        let defaultInner = '';
        const templates: TemplateNode[] = [];
        const directives: DirectiveNode[] = [];

        for (const node of Array.from(child.childNodes)) {
          if (node.nodeType === 3) {
            const text = node.textContent ?? '';
            if (!text.trim()) {
              continue;
            }
            const textErrors = SecurityValidator.validateContent(text);
            if (textErrors.length > 0) {
              errors.push(...textErrors.map(error => ({ ...error, tag: 'SWITCH' })));
              if (options.strictMode) {
                continue;
              }
            }
            defaultInner += `${text}\n`;
            templates.push({ type: 'text', textContent: SecurityValidator.sanitizeString(text) });
            continue;
          }

          const gc = node as Element;
          const { handleElement } = require('../handlers');
          const gcResult = handleElement(gc, options);
          if (gcResult.errors.length > 0) {
            errors.push(...gcResult.errors.map((e: any) => ({ ...e, tag: 'SWITCH' })));
            if (options.strictMode) {
              continue;
            }
          }
          if (gcResult.warnings.length > 0) warnings.push(...gcResult.warnings);
          if (gcResult.code) defaultInner += gcResult.code + '\n';

          if (gcResult.component?.template) {
            templates.push(...gcResult.component.template);
          } else if (isLowerCaseTag(gc)) {
            templates.push(elementToTemplateNode(gc));
          }

          if (gcResult.component?.directives) {
            directives.push(...gcResult.component.directives);
          } else if (gcResult.code && !isLowerCaseTag(gc)) {
            directives.push({ kind: 'statement', code: gcResult.code });
          }
        }

        if (defaultInner.trim()) {
          defaultCase = `default: {\n    try {\n${defaultInner.split('\n').filter(Boolean).map(l => '      ' + l).join('\n')}\n    } catch (error) {\n      console.error('Default case execution error:', error);\n    }\n    break;\n  }`;
        } else {
          defaultCase = 'default: {\n    // Empty default case\n    break;\n  }';
        }

        defaultTemplates = templates;
        defaultDirectives = directives;

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
      codeLength: code.length
    });

    let switchDirective: SwitchDirective | undefined;
    if (componentCases.length > 0 || defaultTemplates) {
      switchDirective = {
        kind: 'switch',
        expression,
        cases: componentCases,
        defaultCase: defaultTemplates
          ? {
              template: defaultTemplates,
              directives: defaultDirectives.length > 0 ? defaultDirectives : undefined
            }
          : undefined
      };
    }

    return {
      code,
      errors,
      warnings,
      component: switchDirective ? { directives: [switchDirective] } : undefined
    };

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
