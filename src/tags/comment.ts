import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleCommentTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const content = element.textContent?.trim() || '';

    if (!content) {
      warnings.push({
        message: 'Empty comment tag',
        tag: 'COMMENT'
      });
      return { code: '// Empty comment', errors, warnings };
    }

    // Security validation - comments shouldn't contain dangerous patterns
    const contentErrors = SecurityValidator.validateContent(content);
    if (contentErrors.length > 0) {
      if (options.strictMode) {
        errors.push(...contentErrors.map(error => ({ ...error, tag: 'COMMENT' })));
        return { code: '', errors, warnings };
      } else {
        warnings.push(...contentErrors.map(error => ({
          message: `Security concern in comment: ${error.message}`,
          tag: 'COMMENT'
        })));
      }
    }

    // Sanitize comment content to prevent code injection through comments
    const sanitizedContent = SecurityValidator.sanitizeString(content);
    
    // Escape for safe comment generation - prevent comment breakout
    const escapedContent = sanitizedContent
      .replace(/\*\//g, '* /')  // Prevent comment block termination
      .replace(/\/\*/g, '/ *')  // Prevent comment block start
      .replace(/\n/g, '\n// '); // Handle multiline comments
    
    // Generate safe comment
    const code = `// ${escapedContent}`;

    if (sanitizedContent !== content) {
      warnings.push({
        message: 'Comment content was sanitized for security',
        tag: 'COMMENT'
      });
    }

    CompilerLogger.logDebug('Generated comment', {
      originalLength: content.length,
      sanitizedLength: sanitizedContent.length,
      wasEscaped: sanitizedContent !== content
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Comment tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'COMMENT'
    };
    
    CompilerLogger.logCompilerError('Comment tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};