import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

const ALLOWED_CONSOLE_METHODS = new Set([
  'log', 'info', 'warn', 'error', 'debug', 'trace'
]);

export const handlePrintTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    // Validate console method type
    const type = element.getAttribute('type') || 'log';
    if (!ALLOWED_CONSOLE_METHODS.has(type)) {
      errors.push({
        type: 'validation',
        message: `Invalid console method: ${type}. Allowed: ${Array.from(ALLOWED_CONSOLE_METHODS).join(', ')}`,
        tag: 'PRINT'
      });
      return { code: '', errors, warnings };
    }

    // Get and validate content
    let content = element.textContent || '';
    
    if (!content.trim()) {
      warnings.push({
        message: 'Empty print statement',
        tag: 'PRINT'
      });
      return { code: '// Empty print statement', errors, warnings };
    }

    // Security validation of content
    const contentErrors = SecurityValidator.validateContent(content);
    if (contentErrors.length > 0) {
      errors.push(...contentErrors);
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
      // In non-strict mode, sanitize the content
      content = SecurityValidator.sanitizeString(content);
      warnings.push({
        message: 'Content was sanitized due to security concerns',
        tag: 'PRINT'
      });
    }

    // Handle loop variable substitution securely
    if (options.loopVariable) {
      // Validate loop variable name
      const loopVarErrors = SecurityValidator.validateJavaScriptIdentifier(options.loopVariable);
      if (loopVarErrors.length > 0) {
        errors.push(...loopVarErrors);
        return { code: '', errors, warnings };
      }

      // Safe replacement: only replace exact {item} patterns
      const itemPattern = /\{item\}/g;
      if (itemPattern.test(content)) {
        // Escape the content for safe template literal usage
        const escapedContent = SecurityValidator.escapeForTemplate(content);
        const replacedContent = escapedContent.replace(itemPattern, `\${${options.loopVariable}}`);
        
        const code = `console.${type}(\`${replacedContent}\`);`;
        
        CompilerLogger.logDebug('Generated print statement with loop variable', {
          type,
          loopVariable: options.loopVariable,
          originalContent: content,
          generatedCode: code
        });
        
        return { code, errors, warnings };
      }
    }

    // Generate safe console statement
    const escapedContent = SecurityValidator.escapeForTemplate(content);
    const code = `console.${type}(\`${escapedContent}\`);`;
    
    CompilerLogger.logDebug('Generated print statement', {
      type,
      originalContent: content,
      generatedCode: code
    });
    
    return { code, errors, warnings };
    
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Print tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'PRINT'
    };
    
    CompilerLogger.logCompilerError('Print tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};