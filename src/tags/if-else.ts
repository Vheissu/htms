import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { elementToTemplateNode, isLowerCaseTag } from '../component/template-utils';
import { DirectiveNode, TemplateNode } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

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
        tag: element.tagName
      });
      return { code: '', errors, warnings };
    }

    const condition = element.getAttribute('condition');
    const trueTemplates: TemplateNode[] = [];
    const trueDirectives: DirectiveNode[] = [];

    if (!condition) {
      errors.push({
        type: 'validation',
        message: 'IF tag requires a condition attribute',
        tag: 'IF'
      });
      return { code: '', errors, warnings };
    }

    // Security validation of condition
    const conditionErrors = SecurityValidator.validateContent(condition);
    if (conditionErrors.length > 0) {
      errors.push(...conditionErrors.map(error => ({ ...error, tag: 'IF' })));
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    // Validate condition format — allow common boolean expressions but reject function calls
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(\s*[<>=!%+\-*/]+\s*[a-zA-Z0-9_$'".\s]+)*(\s*[&|]{2}\s*[a-zA-Z_$][a-zA-Z0-9_$]*(\s*[<>=!%+\-*/]+\s*[a-zA-Z0-9_$'".\s]+)*)?$/.test(condition.trim())) {
      warnings.push({
        message: 'Complex condition detected - may pose security risks',
        tag: 'IF'
      });
      
      if (options.strictMode) {
        errors.push({
          type: 'security',
          message: 'Complex conditions not allowed in strict mode',
          tag: 'IF'
        });
        return { code: '', errors, warnings };
      }
    }
    
    // Prepare bodies: combine raw text (legacy) and child tag code
    let ifInnerCode = '';
    for (const childNode of Array.from(element.childNodes)) {
      if (childNode.nodeType === 3) {
        const text = childNode.textContent ?? '';
        if (text.trim().length === 0) {
          continue;
        }
        const textErrors = SecurityValidator.validateContent(text);
        if (textErrors.length > 0) {
          errors.push(...textErrors.map(error => ({ ...error, tag: 'IF' })));
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
        }
        const sanitizedText = SecurityValidator.sanitizeString(text);
        ifInnerCode += `${text}\n`;
        trueTemplates.push({ type: 'text', textContent: sanitizedText });
        continue;
      }

      const child = childNode as Element;
      const { handleElement } = require('../handlers');
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
        ifInnerCode += childResult.code + '\n';
      }

      if (childResult.component?.template) {
        trueTemplates.push(...childResult.component.template);
      } else if (isLowerCaseTag(child)) {
        trueTemplates.push(elementToTemplateNode(child as Element));
      }

      if (childResult.component?.directives) {
        trueDirectives.push(...childResult.component.directives);
      } else if (childResult.code && !isLowerCaseTag(child)) {
        trueDirectives.push({ kind: 'statement', code: childResult.code });
      }
    }

    // Check for corresponding ELSE tag
    // legacy capture removed; keeping variable names consistent
    let elseInnerCode = '';
    let hasElse = false;
    const falseTemplates: TemplateNode[] = [];
    const falseDirectives: DirectiveNode[] = [];
    
    // Look for next sibling ELSE element
    let nextSibling = element.nextElementSibling;
    if (nextSibling && nextSibling.tagName.toUpperCase() === 'ELSE') {
      hasElse = true;
      // Process ELSE children and text nodes
      for (const childNode of Array.from(nextSibling.childNodes)) {
        if (childNode.nodeType === 3) {
          const text = childNode.textContent ?? '';
          if (text.trim().length === 0) {
            continue;
          }
          const textErrors = SecurityValidator.validateContent(text);
          if (textErrors.length > 0) {
            errors.push(...textErrors.map(error => ({ ...error, tag: 'ELSE' })));
            if (options.strictMode) {
              return { code: '', errors, warnings };
            }
          }
          const sanitizedText = SecurityValidator.sanitizeString(text);
          elseInnerCode += `${text}\n`;
          falseTemplates.push({ type: 'text', textContent: sanitizedText });
          continue;
        }

        const child = childNode as Element;
        const { handleElement } = require('../handlers');
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
          elseInnerCode += childResult.code + '\n';
        }

        if (childResult.component?.template) {
          falseTemplates.push(...childResult.component.template);
        } else if (isLowerCaseTag(child)) {
          falseTemplates.push(elementToTemplateNode(child as Element));
        }

        if (childResult.component?.directives) {
          falseDirectives.push(...childResult.component.directives);
        } else if (childResult.code && !isLowerCaseTag(child)) {
          falseDirectives.push({ kind: 'statement', code: childResult.code });
        }
      }
    }

    // Sanitize condition
    const sanitizedCondition = condition.trim();

    // Generate safe conditional code
    let code = `if (${sanitizedCondition}) {\n`;
    
    if (ifInnerCode.trim()) {
      code += `  try {\n${ifInnerCode.split('\n').filter(Boolean).map(l => '    ' + l).join('\n')}\n  } catch (error) {\n    console.error('IF block execution error:', error);\n  }\n`;
    } else {
      code += '  // Empty if block\n';
    }
    
    code += '}';
    
    if (hasElse) {
      code += ' else {\n';
      if (elseInnerCode.trim()) {
        code += `  try {\n${elseInnerCode.split('\n').filter(Boolean).map(l => '    ' + l).join('\n')}\n  } catch (error) {\n    console.error('ELSE block execution error:', error);\n  }\n`;
      } else {
        code += '  // Empty else block\n';
      }
      code += '}';
    }

    CompilerLogger.logDebug('Generated conditional statement', {
      condition: sanitizedCondition,
      hasIfBody: !!ifInnerCode.trim(),
      hasElse,
      hasElseBody: !!elseInnerCode.trim(),
      codeLength: code.length
    });

    const componentDirective: DirectiveNode = {
      kind: 'condition',
      condition: sanitizedCondition,
      whenTrue: {
        template: trueTemplates,
        directives: trueDirectives.length > 0 ? trueDirectives : undefined
      },
      whenFalse: hasElse
        ? {
            template: falseTemplates,
            directives: falseDirectives.length > 0 ? falseDirectives : undefined
          }
        : undefined
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [componentDirective]
      }
    };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `If-else tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'IF'
    };
    
    CompilerLogger.logCompilerError('If-else tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};
