import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

export const handleCommentTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, failWith } = handlerDiagnostics('COMMENT');

  try {
    const content = element.textContent?.trim() || '';

    if (!content) {
      warnings.push({
        message: 'Empty comment tag',
        tag: 'COMMENT',
      });
      return { code: '// Empty comment', errors, warnings };
    }

    // Security validation - comments shouldn't contain dangerous patterns
    const contentErrors = SecurityValidator.validateContent(content);
    if (contentErrors.length > 0) {
      if (options.strictMode) {
        return failWith(contentErrors);
      } else {
        warnings.push(
          ...contentErrors.map((error) => ({
            message: `Security concern in comment: ${error.message}`,
            tag: 'COMMENT',
          }))
        );
      }
    }

    // Escape for safe comment generation - prevent comment breakout
    const escapedContent = content
      .replace(/\*\//g, '* /') // Prevent comment block termination
      .replace(/\/\*/g, '/ *') // Prevent comment block start
      .replace(/\n/g, '\n// '); // Handle multiline comments

    if (escapedContent !== content) {
      warnings.push({
        message: 'Comment content was rewritten to prevent comment breakout',
        tag: 'COMMENT',
      });
    }

    // Generate safe comment
    const code = `// ${escapedContent}`;

    CompilerLogger.logDebug('Generated comment', {
      originalLength: content.length,
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Comment tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'COMMENT',
    };

    CompilerLogger.logCompilerError('Comment tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
