import { TagHandler, HandlerResult, TagHandlerOptions } from './types';
import { SecurityValidator } from './utils/security';
import { CompilerLogger } from './utils/logger';

// Global counter for element IDs - in production, this should be managed better
const elementCounter: Map<string, number> = new Map();

export const handleHtmlElement: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const tagName = element.tagName.toLowerCase();
    
    // Generate unique variable name for this element
    const count = (elementCounter.get(tagName) || 0) + 1;
    elementCounter.set(tagName, count);
    const varName = `${tagName}${count}`;

    // Start building the element creation code
    let code = `const ${varName} = document.createElement('${tagName}');\n`;

    // Process attributes
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes[i];
      
      // Validate attribute name and value
      const attrErrors = SecurityValidator.validateHtmlAttribute(attr.name, attr.value);
      if (attrErrors.length > 0) {
        if (options.strictMode) {
          errors.push(...attrErrors.map(error => ({ ...error, tag: tagName.toUpperCase() })));
          continue;
        } else {
          warnings.push(...attrErrors.map(error => ({
            message: error.message,
            tag: tagName.toUpperCase()
          })));
        }
      }

      // Sanitize attribute value
      const sanitizedValue = SecurityValidator.sanitizeString(attr.value);
      const escapedName = SecurityValidator.escapeForTemplate(attr.name);
      const escapedValue = SecurityValidator.escapeForTemplate(sanitizedValue);
      
      code += `${varName}.setAttribute('${escapedName}', '${escapedValue}');\n`;
      
      if (attr.value !== sanitizedValue) {
        warnings.push({
          message: `Attribute value sanitized: ${attr.name}`,
          tag: tagName.toUpperCase()
        });
      }
    }

    // Process text content
    if (element.children.length === 0 && element.textContent && element.textContent.trim()) {
      const rawText = element.textContent.trim();

      // Validate text content
      const contentErrors = SecurityValidator.validateContent(rawText);
      if (contentErrors.length > 0) {
        if (options.strictMode) {
          errors.push(...contentErrors.map(error => ({ ...error, tag: tagName.toUpperCase() })));
        } else {
          warnings.push(...contentErrors.map(error => ({ message: error.message, tag: tagName.toUpperCase() })));
        }
      }

      const itemPattern = /\{item\}/g;
      if (options.loopVariable && itemPattern.test(rawText)) {
        const escaped = SecurityValidator.escapeForTemplate(rawText);
        const replaced = escaped.replace(itemPattern, `\${${options.loopVariable}}`);
        code += `${varName}.textContent = \`${replaced}\`;\n`;
      } else {
        const escapedContent = SecurityValidator.escapeForTemplate(rawText);
        code += `${varName}.textContent = \`${escapedContent}\`;\n`;
      }
    }

    // Process child elements recursively; ensure children append under this element
    for (const child of Array.from(element.children)) {
      const childResult = handleElement(child, { ...options, appendTargetVar: varName });
      
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
      codeLength: code.length
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `HTML element handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: element.tagName.toUpperCase()
    };
    
    CompilerLogger.logCompilerError('HTML element handler error', {
      tagName: element.tagName,
      error: runtimeError.message,
      element: element.outerHTML
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
