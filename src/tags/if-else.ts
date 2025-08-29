import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
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
    const ifBody = element.children.length === 0 ? (element.textContent?.trim() || '') : '';

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
    // Legacy raw text support
    if (ifBody) {
      const bodyErrors = SecurityValidator.validateContent(ifBody);
      if (bodyErrors.length > 0 && options.strictMode) {
        errors.push(...bodyErrors.map(error => ({ ...error, tag: 'IF' })));
        return { code: '', errors, warnings };
      }
      // Use as-is (no HTML escaping) — guarded by content validation above
      ifInnerCode += `${ifBody}\n`;
    }
    // Child elements
    for (const child of Array.from(element.children)) {
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
    }

    // Check for corresponding ELSE tag
    // legacy capture removed; keeping variable names consistent
    let elseInnerCode = '';
    let hasElse = false;
    
    // Look for next sibling ELSE element
    let nextSibling = element.nextElementSibling;
    if (nextSibling && nextSibling.tagName.toUpperCase() === 'ELSE') {
      hasElse = true;
      const elseContent = nextSibling.children.length === 0 ? (nextSibling.textContent?.trim() || '') : '';
      
      if (elseContent) {
        const elseErrors = SecurityValidator.validateContent(elseContent);
        if (elseErrors.length > 0) {
          errors.push(...elseErrors.map(error => ({ ...error, tag: 'ELSE' })));
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
        }
        elseInnerCode += `${elseContent}\n`;
      }

      // Process ELSE children
      for (const child of Array.from(nextSibling.children)) {
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

    return { code, errors, warnings };

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
