import { handleElement, isStandardHtmlElement as coreIsStandardHtmlElement } from '../handlers';
import { CompilerError, CompilerWarning, HandlerResult, ParseOptions, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { ComponentIR, createEmptyComponentIR } from './ir';
import { elementToTemplateNode } from './template-utils';

interface ComponentRenderResult {
  ir: ComponentIR;
  errors: CompilerError[];
  warnings: CompilerWarning[];
}

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
          ...contentErrors.map(error => ({
            ...error,
            tag: 'TEXT'
          }))
        );
        if (strictMode) {
          continue;
        }
      }

      ir.templateNodes.push({
        type: 'text',
        textContent: textContent
      });
      continue;
    }

    if (node.nodeType !== 1) {
      continue;
    }

    const element = node as Element;
    if (element.tagName && element.tagName.toUpperCase() === 'ELSE') {
      warnings.push({
        message: 'Unpaired top-level <else> ignored inside component',
        tag: 'ELSE'
      });
      continue;
    }

    if (coreIsStandardHtmlElement(element)) {
      ir.templateNodes.push(elementToTemplateNode(element));
      continue;
    }

    const handlerOptions: TagHandlerOptions = {
      strictMode,
      parentContext: 'component',
      appendTargetVar,
      componentContext: true
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
