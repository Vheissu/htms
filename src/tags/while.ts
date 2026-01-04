import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { DirectiveNode, TemplateNode, WhileDirective } from '../component/ir';
import { elementToTemplateNode, isLowerCaseTag } from '../component/template-utils';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

const DEFAULT_MAX_ITERATIONS = 1000;
const MAX_ITERATION_LIMIT = 10000;

export const handleWhileTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const condition = element.getAttribute('condition');
    const maxAttr = element.getAttribute('max');

    if (!condition) {
      errors.push({
        type: 'validation',
        message: 'WHILE tag requires a condition attribute',
        tag: 'WHILE'
      });
      return { code: '', errors, warnings };
    }

    const conditionErrors = SecurityValidator.validateContent(condition);
    if (conditionErrors.length > 0) {
      errors.push(...conditionErrors.map(error => ({ ...error, tag: 'WHILE' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    let maxIterations = DEFAULT_MAX_ITERATIONS;
    if (maxAttr && maxAttr.trim().length > 0) {
      const maxErrors = SecurityValidator.validateNumericValue(maxAttr);
      if (maxErrors.length > 0) {
        errors.push(...maxErrors.map(error => ({ ...error, tag: 'WHILE' })));
        return { code: '', errors, warnings };
      }
      maxIterations = Math.floor(Number(maxAttr));
      if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
        errors.push({
          type: 'validation',
          message: 'WHILE max must be a positive number',
          tag: 'WHILE'
        });
        return { code: '', errors, warnings };
      }
      if (maxIterations > MAX_ITERATION_LIMIT) {
        warnings.push({
          message: `WHILE max is very high (${maxIterations}); consider a lower value`,
          tag: 'WHILE'
        });
      }
    }

    let bodyCode = '';
    const templateNodes: TemplateNode[] = [];
    const directives: DirectiveNode[] = [];

    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) {
        const text = node.textContent ?? '';
        if (!text.trim()) {
          continue;
        }
        const textErrors = SecurityValidator.validateContent(text);
        if (textErrors.length > 0) {
          errors.push(...textErrors.map(error => ({ ...error, tag: 'WHILE' })));
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
        }
        bodyCode += `${text}\n`;
        templateNodes.push({ type: 'text', textContent: SecurityValidator.sanitizeString(text) });
        continue;
      }

      if (node.nodeType !== 1) {
        continue;
      }

      const child = node as Element;
      const childOptions: TagHandlerOptions = {
        ...options,
        parentContext: 'loop'
      };
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
        bodyCode += childResult.code + '\n';
      }

      if (childResult.component?.template) {
        templateNodes.push(...childResult.component.template);
      } else if (isLowerCaseTag(child)) {
        templateNodes.push(elementToTemplateNode(child));
      }

      if (childResult.component?.directives) {
        directives.push(...childResult.component.directives);
      } else if (childResult.code && !isLowerCaseTag(child)) {
        directives.push({ kind: 'statement', code: childResult.code });
      }
    }

    const safeCondition = condition.trim();
    const loopBody = bodyCode.trim()
      ? `  try {\n${bodyCode
          .split('\n')
          .filter(Boolean)
          .map(line => `    ${line}`)
          .join('\n')}\n  } catch (error) {\n    console.error('WHILE body error:', error);\n  }\n`
      : '  // Empty WHILE body\n';

    const code = `{
  let __htmsGuard = 0;
  while (${safeCondition}) {
    if (__htmsGuard++ >= ${maxIterations}) { console.warn('WHILE exceeded max iterations'); break; }
${loopBody}  }
}`;

    const whileDirective: WhileDirective = {
      kind: 'while',
      condition: safeCondition,
      maxIterations,
      template: templateNodes,
      directives: directives.length > 0 ? directives : undefined
    };

    CompilerLogger.logDebug('Generated while loop', {
      condition: safeCondition,
      maxIterations,
      hasBody: bodyCode.trim().length > 0,
      templateCount: templateNodes.length
    });

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [whileDirective]
      }
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `While tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'WHILE'
    };
    CompilerLogger.logCompilerError('While tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    return { code: '', errors: [runtimeError], warnings };
  }
};
