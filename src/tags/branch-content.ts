import { HandlerResult, TagHandlerOptions } from '../types';
import { DirectiveNode, TemplateNode } from '../component/ir';
import {
  elementToTemplateNode,
  isLowerCaseTag,
  templateTextValue,
} from '../component/template-utils';
import { SecurityValidator } from '../utils/security';
import { handleElement } from '../handlers';
import { SourceElement } from '../source-dom';

// The text and child elements of a conditional branch (<if>, <else>,
// <case>, ...) as legacy code, template nodes and directives. Text errors
// are reported under `tag`, and so are the children's errors when
// `retagChildErrors` is set.
export function collectBranchContent(
  element: SourceElement,
  options: TagHandlerOptions,
  tag: string,
  errors: HandlerResult['errors'],
  warnings: HandlerResult['warnings'],
  retagChildErrors = false
): { code: string; templates: TemplateNode[]; directives: DirectiveNode[] } {
  let innerCode = '';
  const templates: TemplateNode[] = [];
  const directives: DirectiveNode[] = [];

  for (const childNode of Array.from(element.childNodes)) {
    if (childNode.nodeType === 3) {
      const text = templateTextValue(childNode);
      if (text === null) {
        continue;
      }
      const textErrors = SecurityValidator.validateContent(text);
      if (textErrors.length > 0) {
        errors.push(...textErrors.map((error) => ({ ...error, tag })));
        if (options.strictMode) {
          continue;
        }
      }
      innerCode += `${text}\n`;
      templates.push({ type: 'text', textContent: text });
      continue;
    }

    const child = childNode as SourceElement;
    const childResult = handleElement(child, options);
    if (childResult.errors.length > 0) {
      errors.push(
        ...(retagChildErrors
          ? childResult.errors.map((error) => ({ ...error, tag }))
          : childResult.errors)
      );
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
      templates.push(elementToTemplateNode(child as SourceElement));
    }

    if (childResult.component?.directives) {
      directives.push(...childResult.component.directives);
    } else if (childResult.code && !isLowerCaseTag(child)) {
      directives.push({ kind: 'statement', code: childResult.code });
    }
  }

  return { code: innerCode, templates, directives };
}
