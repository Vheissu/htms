import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import {
  elementToTemplateNode,
  isLowerCaseTag,
  templateTextValue,
} from '../component/template-utils';
import { DirectiveNode, TemplateChild, TemplateNode } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope, withLocals } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { handleElement } from '../handlers';

const MAX_COUNT = 10000;

export const handleRepeatTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const variable = element.getAttribute('variable');
    const indexVar = element.getAttribute('index') || '';
    const count = element.getAttribute('count');
    const body =
      element.children.length === 0 ? element.textContent?.trim() || '' : '';

    // Validate that we have either variable or count
    if (!variable && !count) {
      errors.push({
        type: 'validation',
        message:
          'REPEAT tag requires either variable (for array iteration) or count (for numeric loop)',
        tag: 'REPEAT',
      });
      return { code: '', errors, warnings };
    }

    // Both variable and count cannot be specified together
    if (variable && count) {
      errors.push({
        type: 'validation',
        message: 'REPEAT tag cannot have both variable and count attributes',
        tag: 'REPEAT',
      });
      return { code: '', errors, warnings };
    }

    let loopCode = '';
    const itemAttr = element.getAttribute('item');
    if (itemAttr) {
      const itemErrors =
        SecurityValidator.validateJavaScriptIdentifier(itemAttr);
      if (itemErrors.length > 0) {
        errors.push(
          ...itemErrors.map((e) => ({
            ...e,
            tag: 'REPEAT',
            message: `Invalid item variable: ${itemAttr}`,
          }))
        );
        return { code: '', errors, warnings };
      }
    }
    let loopVariable = itemAttr || 'item';
    let countNum: number | null = null;
    let dynamicCount: string | null = null;
    const componentDirectives: DirectiveNode[] = [];
    const componentTemplateChildren: TemplateNode[] = [];
    let componentSource = variable ?? '';

    if (variable) {
      // Array iteration mode
      const simpleIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(variable);
      componentSource =
        options.componentContext && simpleIdentifier && !options.componentFields
          ? `this.${variable}`
          : handlerScope(options).expression(variable);
      if (!simpleIdentifier) {
        const exprErrors = SecurityValidator.validateContent(variable);
        if (exprErrors.length > 0) {
          errors.push(
            ...exprErrors.map((error) => ({
              ...error,
              tag: 'REPEAT',
              message: `Invalid variable expression: ${variable}`,
            }))
          );
          return { code: '', errors, warnings };
        }
      } else {
        const varErrors =
          SecurityValidator.validateJavaScriptIdentifier(variable);
        if (varErrors.length > 0) {
          errors.push(
            ...varErrors.map((error) => ({
              ...error,
              tag: 'REPEAT',
              message: `Invalid variable name: ${variable}`,
            }))
          );
          return { code: '', errors, warnings };
        }
      }

      if (indexVar) {
        const idxErrors =
          SecurityValidator.validateJavaScriptIdentifier(indexVar);
        if (idxErrors.length > 0) {
          errors.push(
            ...idxErrors.map((e) => ({
              ...e,
              tag: 'REPEAT',
              message: `Invalid index variable: ${indexVar}`,
            }))
          );
          return { code: '', errors, warnings };
        }
        // for-index pattern exposes both index and item
        loopCode = `for (let ${indexVar} = 0; ${indexVar} < ${variable}.length; ${indexVar}++) {\n  const ${loopVariable} = ${variable}[${indexVar}];`;
      } else {
        loopCode = `for (const ${loopVariable} of ${variable}) {`;
      }
    } else if (
      count &&
      options.componentContext &&
      !SecurityValidator.isNumericLiteral(count.trim())
    ) {
      // count="rating" — evaluated on each render and clamped to 0..10000.
      const exprErrors = SecurityValidator.validateContent(count);
      if (exprErrors.length > 0) {
        errors.push(
          ...exprErrors.map((error) => ({ ...error, tag: 'REPEAT' }))
        );
        return { code: '', errors, warnings };
      }
      if (indexVar) {
        const idxErrors =
          SecurityValidator.validateJavaScriptIdentifier(indexVar);
        if (idxErrors.length > 0) {
          errors.push(
            ...idxErrors.map((error) => ({ ...error, tag: 'REPEAT' }))
          );
          return { code: '', errors, warnings };
        }
      }
      loopVariable = indexVar || 'i';
      dynamicCount = `Math.min(${MAX_COUNT}, Math.max(0, Math.floor(Number(${handlerScope(options).expression(count.trim())}) || 0)))`;
    } else if (count) {
      // Numeric iteration mode
      const countErrors = SecurityValidator.validateNumericValue(count);
      if (countErrors.length > 0) {
        errors.push(
          ...countErrors.map((error) => ({ ...error, tag: 'REPEAT' }))
        );
        return { code: '', errors, warnings };
      }

      countNum = parseInt(count, 10);
      if (countNum < 0 || countNum > 10000) {
        errors.push({
          type: 'validation',
          message: `Count must be between 0 and 10000, got: ${countNum}`,
          tag: 'REPEAT',
        });
        return { code: '', errors, warnings };
      }

      if (countNum > 1000) {
        warnings.push({
          message: `Large loop count (${countNum}) may impact performance`,
          tag: 'REPEAT',
        });
      }

      loopVariable = indexVar || 'i'; // use index for numeric loops
      loopCode = `for (let ${loopVariable} = 0; ${loopVariable} < ${countNum}; ${loopVariable}++) {`;
    }

    // Security validation of loop body
    if (body) {
      const bodyErrors = SecurityValidator.validateContent(body);
      if (bodyErrors.length > 0) {
        errors.push(
          ...bodyErrors.map((error) => ({ ...error, tag: 'REPEAT' }))
        );
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }
    }

    // Process child elements that might reference the loop variable
    let childCode = '';
    for (const childNode of Array.from(element.childNodes)) {
      if (childNode.nodeType === 3) {
        const text = options.componentContext
          ? templateTextValue(childNode)
          : null;
        if (text !== null) {
          componentTemplateChildren.push({ type: 'text', textContent: text });
        }
        continue;
      }
      if (childNode.nodeType !== 1) {
        continue;
      }
      const child = childNode as Element;
      const childOptions: TagHandlerOptions = withLocals(
        { ...options, loopVariable, parentContext: 'loop' },
        loopVariable,
        indexVar || undefined
      );

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

      if (childResult.component?.template) {
        componentTemplateChildren.push(...childResult.component.template);
      } else if (isLowerCaseTag(child)) {
        componentTemplateChildren.push(
          elementToTemplateNode(child as Element, (nested: Element) => {
            const nestedResult = handleElement(nested, childOptions);
            errors.push(...nestedResult.errors);
            warnings.push(...nestedResult.warnings);
            const children = (nestedResult.component?.template ??
              []) as TemplateChild[];
            if (nestedResult.component?.directives) {
              for (const directive of nestedResult.component.directives) {
                children.push({ type: 'directive', directive });
              }
            } else if (nestedResult.code) {
              children.push({
                type: 'directive',
                directive: { kind: 'statement', code: nestedResult.code },
              });
            }
            return children;
          })
        );
      }

      if (childResult.component?.directives) {
        componentDirectives.push(...childResult.component.directives);
      } else if (childResult.code && !isLowerCaseTag(child)) {
        componentDirectives.push({ kind: 'statement', code: childResult.code });
      }
    }

    // Combine loop body and child code
    let combinedBody = '';
    if (body) {
      combinedBody += `  try {\n    ${body}\n  } catch (error) {\n    console.error('Loop body execution error:', error);\n  }\n`;
    }

    if (childCode) {
      combinedBody += childCode;
    }

    if (
      !combinedBody.trim() &&
      componentTemplateChildren.length === 0 &&
      componentDirectives.length === 0
    ) {
      warnings.push({
        message: 'Empty loop body',
        tag: 'REPEAT',
      });
      combinedBody = '  // Empty loop body\n';
    }

    const code = `${loopCode}\n${combinedBody}}`;

    CompilerLogger.logDebug('Generated loop', {
      type: variable ? 'array-iteration' : 'numeric-loop',
      variable: variable || `count:${count}`,
      loopVariable,
      hasBody: !!body,
      hasChildren: !!childCode,
      codeLength: code.length,
    });

    const keyAttr = element.getAttribute('key')?.trim();
    let componentKey: string | undefined;
    if (keyAttr) {
      if (!variable) {
        errors.push({
          type: 'validation',
          message: 'REPEAT key is only supported with variable (array) loops',
          tag: 'REPEAT',
        });
        return { code: '', errors, warnings };
      }
      const keyErrors = SecurityValidator.validateContent(keyAttr);
      if (keyErrors.length > 0) {
        errors.push(
          ...keyErrors.map((error) => ({
            ...error,
            tag: 'REPEAT',
            message: `Invalid key expression: ${keyAttr}`,
          }))
        );
        return { code: '', errors, warnings };
      }
      componentKey = handlerScope(
        withLocals(options, loopVariable, indexVar || undefined)
      ).expression(keyAttr);
    }

    const componentLoopDirective: DirectiveNode | undefined = variable
      ? {
          kind: 'loop',
          mode: 'array',
          source: componentSource,
          itemVar: loopVariable,
          indexVar: indexVar || undefined,
          key: componentKey,
          template: componentTemplateChildren,
          directives: componentDirectives,
        }
      : countNum !== null || dynamicCount !== null
        ? {
            kind: 'loop',
            mode: 'range',
            count: dynamicCount ?? String(countNum),
            indexVar: loopVariable,
            template: componentTemplateChildren,
            directives: componentDirectives,
          }
        : undefined;

    return {
      code,
      errors,
      warnings,
      component: componentLoopDirective
        ? { directives: [componentLoopDirective] }
        : undefined,
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Repeat tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'REPEAT',
    };

    CompilerLogger.logCompilerError('Repeat tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
