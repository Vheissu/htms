import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import {
  elementToTemplateNode,
  isLowerCaseTag,
} from '../component/template-utils';
import { DirectiveNode, TemplateNode } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handleElement } from '../handlers';

type ConsumedElement = Element & { __htmsConsumed?: boolean };

const ELSEIF_TAGS = new Set(['ELSEIF', 'ELSE-IF']);

function isElseIfTag(tagName: string): boolean {
  return ELSEIF_TAGS.has(tagName.toUpperCase());
}

function validateCondition(
  condition: string,
  tag: string,
  errors: HandlerResult['errors'],
  warnings: HandlerResult['warnings'],
  strictMode: boolean
): string | null {
  const conditionErrors = SecurityValidator.validateContent(condition);
  if (conditionErrors.length > 0) {
    errors.push(...conditionErrors.map((error) => ({ ...error, tag })));
    if (strictMode) {
      return null;
    }
  }

  if (!SecurityValidator.isSideEffectFreeExpression(condition.trim())) {
    warnings.push({
      message: 'Complex condition detected - may pose security risks',
      tag,
    });

    if (strictMode) {
      errors.push({
        type: 'security',
        message: 'Complex conditions not allowed in strict mode',
        tag,
      });
      return null;
    }
  }

  return condition.trim();
}

function collectBranchContent(
  element: Element,
  options: TagHandlerOptions,
  tag: string,
  errors: HandlerResult['errors'],
  warnings: HandlerResult['warnings']
): { code: string; templates: TemplateNode[]; directives: DirectiveNode[] } {
  let innerCode = '';
  const templates: TemplateNode[] = [];
  const directives: DirectiveNode[] = [];

  for (const childNode of Array.from(element.childNodes)) {
    if (childNode.nodeType === 3) {
      const text = childNode.textContent ?? '';
      if (text.trim().length === 0) {
        continue;
      }
      const textErrors = SecurityValidator.validateContent(text);
      if (textErrors.length > 0) {
        errors.push(...textErrors.map((error) => ({ ...error, tag })));
        if (options.strictMode) {
          continue;
        }
      }
      const sanitizedText = SecurityValidator.sanitizeString(text);
      innerCode += `${text}\n`;
      templates.push({ type: 'text', textContent: sanitizedText });
      continue;
    }

    const child = childNode as Element;
    const childResult = handleElement(child, options);
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
      innerCode += childResult.code + '\n';
    }

    if (childResult.component?.template) {
      templates.push(...childResult.component.template);
    } else if (isLowerCaseTag(child)) {
      templates.push(elementToTemplateNode(child as Element));
    }

    if (childResult.component?.directives) {
      directives.push(...childResult.component.directives);
    } else if (childResult.code && !isLowerCaseTag(child)) {
      directives.push({ kind: 'statement', code: childResult.code });
    }
  }

  return { code: innerCode, templates, directives };
}

function formatBranchBody(code: string, label: string): string {
  if (!code.trim()) {
    return `  // Empty ${label.toLowerCase()} block`;
  }
  const lines = code
    .split('\n')
    .filter(Boolean)
    .map((line) => `    ${line}`)
    .join('\n');
  return `  try {\n${lines}\n  } catch (error) {\n    console.error('${label} block execution error:', error);\n  }`;
}

export const handleIfElseTags: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    if (element.tagName.toUpperCase() !== 'IF') {
      errors.push({
        type: 'validation',
        message: 'This handler only processes IF tags',
        tag: element.tagName,
      });
      return { code: '', errors, warnings };
    }

    const condition = element.getAttribute('condition');
    if (!condition) {
      errors.push({
        type: 'validation',
        message: 'IF tag requires a condition attribute',
        tag: 'IF',
      });
      return { code: '', errors, warnings };
    }
    const sanitizedCondition = validateCondition(
      condition,
      'IF',
      errors,
      warnings,
      options.strictMode ?? false
    );
    if (!sanitizedCondition) {
      return { code: '', errors, warnings };
    }

    const ifBranch = collectBranchContent(
      element,
      options,
      'IF',
      errors,
      warnings
    );
    const branches: Array<{
      condition: string;
      code: string;
      templates: TemplateNode[];
      directives: DirectiveNode[];
    }> = [
      {
        condition: sanitizedCondition,
        code: ifBranch.code,
        templates: ifBranch.templates,
        directives: ifBranch.directives,
      },
    ];

    let elseBranch: {
      code: string;
      templates: TemplateNode[];
      directives: DirectiveNode[];
    } | null = null;

    let nextSibling = element.nextElementSibling;
    while (nextSibling) {
      const tagName = nextSibling.tagName.toUpperCase();
      if (isElseIfTag(tagName)) {
        (nextSibling as ConsumedElement).__htmsConsumed = true;
        const elseIfCondition = nextSibling.getAttribute('condition');
        if (!elseIfCondition) {
          errors.push({
            type: 'validation',
            message: 'ELSEIF tag requires a condition attribute',
            tag: tagName,
          });
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
          nextSibling = nextSibling.nextElementSibling;
          continue;
        }

        const sanitizedElseIf = validateCondition(
          elseIfCondition,
          tagName,
          errors,
          warnings,
          options.strictMode ?? false
        );
        if (!sanitizedElseIf) {
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
          nextSibling = nextSibling.nextElementSibling;
          continue;
        }

        const branch = collectBranchContent(
          nextSibling,
          options,
          tagName,
          errors,
          warnings
        );
        branches.push({
          condition: sanitizedElseIf,
          code: branch.code,
          templates: branch.templates,
          directives: branch.directives,
        });
        nextSibling = nextSibling.nextElementSibling;
        continue;
      }

      if (tagName === 'ELSE') {
        (nextSibling as ConsumedElement).__htmsConsumed = true;
        const branch = collectBranchContent(
          nextSibling,
          options,
          'ELSE',
          errors,
          warnings
        );
        elseBranch = {
          code: branch.code,
          templates: branch.templates,
          directives: branch.directives,
        };
      }
      break;
    }

    const [firstBranch, ...remainingBranches] = branches;
    let code = `if (${firstBranch.condition}) {\n${formatBranchBody(
      firstBranch.code,
      'IF'
    )}\n}`;

    for (const branch of remainingBranches) {
      code += ` else if (${branch.condition}) {\n${formatBranchBody(
        branch.code,
        'ELSEIF'
      )}\n}`;
    }

    if (elseBranch) {
      code += ` else {\n${formatBranchBody(elseBranch.code, 'ELSE')}\n}`;
    }

    const buildChain = (remaining: typeof branches): DirectiveNode => {
      const [current, ...rest] = remaining;
      if (!current) {
        throw new Error('Conditional chain cannot be empty');
      }
      const whenTrue = {
        template: current.templates,
        directives:
          current.directives.length > 0 ? current.directives : undefined,
      };

      if (rest.length === 0) {
        return {
          kind: 'condition',
          condition: current.condition,
          whenTrue,
          whenFalse: elseBranch
            ? {
                template: elseBranch.templates,
                directives:
                  elseBranch.directives.length > 0
                    ? elseBranch.directives
                    : undefined,
              }
            : undefined,
        };
      }

      const nextDirective = buildChain(rest);
      return {
        kind: 'condition',
        condition: current.condition,
        whenTrue,
        whenFalse: {
          template: [],
          directives: [nextDirective],
        },
      };
    };

    const componentDirective = buildChain(branches);

    CompilerLogger.logDebug('Generated conditional statement', {
      condition: sanitizedCondition,
      hasIfBody: !!ifBranch.code.trim(),
      hasElse: !!elseBranch,
      hasElseBody: !!elseBranch?.code.trim(),
      elseIfCount: branches.length - 1,
      codeLength: code.length,
    });

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [componentDirective],
      },
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `If-else tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'IF',
    };

    CompilerLogger.logCompilerError('If-else tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
