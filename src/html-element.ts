import { TagHandler, HandlerResult, TagHandlerOptions } from './types';
import { SecurityValidator } from './utils/security';
import { CompilerLogger } from './utils/logger';
import { TemplateChild } from './component/ir';
import {
  collectTemplateSecurityErrors,
  elementToTemplateNode,
  partitionTemplateErrors,
} from './component/template-utils';
import { getNodeLocation } from './diagnostics';

// Location-based names keep compiled output deterministic; the counter is a
// fallback for elements parsed without node locations (tests, direct DOM).
const elementCounter: Map<string, number> = new Map();

function elementVarName(tagName: string, element: Element): string {
  const location = getNodeLocation(element);
  if (location) {
    return `${tagName}_${location.line}_${location.column}`;
  }
  const count = (elementCounter.get(tagName) || 0) + 1;
  elementCounter.set(tagName, count);
  return `${tagName}${count}`;
}

export const handleHtmlElement: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const tagName = element.tagName.toLowerCase();

    // Component mode: convert markup to template nodes. Directive tags
    // nested inside the element are resolved into embedded template
    // children so they render scoped to this element.
    if (options.componentContext) {
      const findings = partitionTemplateErrors(
        collectTemplateSecurityErrors(element),
        options.strictMode ?? false
      );
      errors.push(...findings.errors);
      warnings.push(...findings.warnings);
      const node = elementToTemplateNode(element, (child) => {
        const childResult = handleElement(child, {
          ...options,
          appendTargetVar: undefined,
        });
        errors.push(...childResult.errors);
        warnings.push(...childResult.warnings);

        const children: TemplateChild[] = [];
        if (childResult.component?.template) {
          children.push(...childResult.component.template);
        }
        if (childResult.component?.directives) {
          for (const directive of childResult.component.directives) {
            children.push({ type: 'directive', directive });
          }
        } else if (childResult.code) {
          children.push({
            type: 'directive',
            directive: { kind: 'statement', code: childResult.code },
          });
        }
        return children;
      });
      return {
        code: '',
        errors,
        warnings,
        component: { template: [node] },
      };
    }

    // Generate unique variable name for this element
    const varName = elementVarName(tagName, element);

    // Start building the element creation code
    let code = `const ${varName} = document.createElement('${tagName}');\n`;

    // Process attributes
    for (const attr of Array.from(element.attributes)) {
      // Validate attribute name and value
      const attrErrors = SecurityValidator.validateHtmlAttribute(
        attr.name,
        attr.value
      );
      if (attrErrors.length > 0) {
        if (options.strictMode) {
          errors.push(
            ...attrErrors.map((error) => ({
              ...error,
              tag: tagName.toUpperCase(),
            }))
          );
          continue;
        } else {
          warnings.push(
            ...attrErrors.map((error) => ({
              message: error.message,
              tag: tagName.toUpperCase(),
            }))
          );
        }
      }

      code += `${varName}.setAttribute(${SecurityValidator.jsStringLiteral(attr.name)}, ${SecurityValidator.jsStringLiteral(attr.value)});\n`;
    }

    // Process text content
    if (
      element.children.length === 0 &&
      element.textContent &&
      element.textContent.trim()
    ) {
      const rawText = element.textContent.trim();

      // Validate text content
      const contentErrors = SecurityValidator.validateContent(rawText);
      if (contentErrors.length > 0) {
        if (options.strictMode) {
          errors.push(
            ...contentErrors.map((error) => ({
              ...error,
              tag: tagName.toUpperCase(),
            }))
          );
        } else {
          warnings.push(
            ...contentErrors.map((error) => ({
              message: error.message,
              tag: tagName.toUpperCase(),
            }))
          );
        }
      }

      // loopVariable is a validated JS identifier, so this is safe.
      const itemPattern = options.loopVariable
        ? // eslint-disable-next-line security/detect-non-literal-regexp
          new RegExp(`\\{${options.loopVariable}\\}`, 'g')
        : null;
      if (itemPattern && itemPattern.test(rawText)) {
        const escaped = SecurityValidator.escapeForTemplate(rawText);
        const replaced = escaped.replace(
          itemPattern,
          `\${${options.loopVariable}}`
        );
        code += `${varName}.textContent = \`${replaced}\`;\n`;
      } else {
        const escapedContent = SecurityValidator.escapeForTemplate(rawText);
        code += `${varName}.textContent = \`${escapedContent}\`;\n`;
      }
    }

    // Process child elements recursively; ensure children append under this element
    for (const child of Array.from(element.children)) {
      const childResult = handleElement(child, {
        ...options,
        appendTargetVar: varName,
      });

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
        code += childResult.code;
      }
    }

    // Append to parent container or document body
    if (options.appendTargetVar) {
      code += `${options.appendTargetVar}.appendChild(${varName});\n`;
    } else if (options.parentContext === 'root') {
      code += `document.body.appendChild(${varName});\n`;
    }

    CompilerLogger.logDebug('Generated HTML element', {
      tagName,
      varName,
      attributeCount: element.attributes.length,
      hasTextContent: !!element.textContent?.trim(),
      childCount: element.children.length,
      codeLength: code.length,
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `HTML element handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: element.tagName.toUpperCase(),
    };

    CompilerLogger.logCompilerError('HTML element handler error', {
      tagName: element.tagName,
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};

// Import the main handleElement function to avoid circular imports
import { handleElement } from './handlers';

// Function to reset element counter (useful for testing)
export function resetElementCounter(): void {
  elementCounter.clear();
}
