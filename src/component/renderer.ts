import {
  handleElement,
  isStandardHtmlElement as coreIsStandardHtmlElement,
} from '../handlers';
import {
  CompilerError,
  CompilerWarning,
  HandlerResult,
  ParseOptions,
  TagHandlerOptions,
} from '../types';
import { SecurityValidator } from '../utils/security';
import { ComponentIR, createEmptyComponentIR } from './ir';
import {
  collectTemplateSecurityErrors,
  elementToTemplateNode,
} from './template-utils';
import { addNodeLocations } from '../diagnostics';

interface ComponentRenderResult {
  ir: ComponentIR;
  errors: CompilerError[];
  warnings: CompilerWarning[];
}

type ConsumableElement = Element & { __htmsConsumed?: boolean };

export function elementsToComponentCode(
  componentElement: Element,
  appendTargetVar: string,
  options: ParseOptions
): ComponentRenderResult {
  const ir = createEmptyComponentIR();
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];
  const strictMode = options.strictMode ?? false;

  for (const node of Array.from(componentElement.childNodes)) {
    if (node.nodeType === 3) {
      const textContent = node.textContent?.trim();
      if (!textContent) {
        continue;
      }
      const contentErrors = SecurityValidator.validateContent(textContent);
      if (contentErrors.length > 0) {
        errors.push(
          ...contentErrors.map((error) => ({
            ...error,
            tag: 'TEXT',
          }))
        );
        if (strictMode) {
          continue;
        }
      }

      ir.templateNodes.push({
        type: 'text',
        textContent: textContent,
      });
      continue;
    }

    if (node.nodeType !== 1) {
      continue;
    }

    const element = node as Element;
    if ((element as ConsumableElement).__htmsConsumed) {
      continue;
    }
    if (element.tagName) {
      const tagName = element.tagName.toUpperCase();
      if (tagName === 'ELSE' || tagName === 'ELSEIF' || tagName === 'ELSE-IF') {
        warnings.push(
          ...addNodeLocations(
            [
              {
                message:
                  'Unpaired top-level conditional branch ignored inside component',
                tag: tagName,
              },
            ],
            element
          )
        );
        continue;
      }
    }

    const tagName = element.tagName.toUpperCase();
    const treatAsCustom =
      tagName === 'STYLE' &&
      (element.hasAttribute('selector') ||
        element.hasAttribute('prop') ||
        element.hasAttribute('name'));

    if (coreIsStandardHtmlElement(element) && !treatAsCustom) {
      const templateErrors = collectTemplateSecurityErrors(element);
      if (templateErrors.length > 0) {
        if (strictMode) {
          errors.push(...addNodeLocations(templateErrors, element));
          continue;
        }
        warnings.push(
          ...addNodeLocations(
            templateErrors.map((error) => ({
              message: error.message,
              tag: error.tag,
            })),
            element
          )
        );
      }
      ir.templateNodes.push(elementToTemplateNode(element));
      continue;
    }

    const handlerOptions: TagHandlerOptions = {
      strictMode,
      parentContext: 'component',
      appendTargetVar,
      componentContext: true,
    };

    const result: HandlerResult = handleElement(element, handlerOptions);
    if (result.errors.length > 0) {
      errors.push(...result.errors);
      if (strictMode) {
        continue;
      }
    }

    if (result.warnings.length > 0) {
      warnings.push(...result.warnings);
    }

    if (result.component?.template) {
      ir.templateNodes.push(...result.component.template);
    }

    if (result.component?.directives) {
      ir.directives.push(...result.component.directives);
      continue;
    }

    if (result.code) {
      ir.directives.push({ kind: 'statement', code: result.code });
    }
  }

  return { ir, errors, warnings };
}
