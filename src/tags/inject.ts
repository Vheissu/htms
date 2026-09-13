import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleInjectTag: TagHandler = (
  element: Element,
  _options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  // SECURITY WARNING: This tag is inherently dangerous and disabled by
  // default regardless of strict mode — it requires the env opt-in.
  if (process.env.HTMS_ALLOW_INJECT_TAG !== 'true') {
    errors.push({
      type: 'security',
      message:
        'INJECT tag is disabled for security reasons. Set HTMS_ALLOW_INJECT_TAG=true to enable (NOT RECOMMENDED)',
      tag: 'INJECT',
    });
    return { code: '', errors, warnings };
  }

  try {
    const selector = element.getAttribute('selector');
    const content = element.innerHTML;

    if (!selector || !content) {
      errors.push({
        type: 'validation',
        message: 'INJECT tag requires both selector and content',
        tag: 'INJECT',
      });
      return { code: '', errors, warnings };
    }

    // Validate selector - must be a simple CSS selector
    if (!SecurityValidator.isAllowedSelector(selector)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector format',
        tag: 'INJECT',
      });
      return { code: '', errors, warnings };
    }

    // Security validation of content - this is critical
    const contentErrors = SecurityValidator.validateContent(content);
    if (contentErrors.length > 0) {
      errors.push(...contentErrors);
      CompilerLogger.logSecurityIssue('Dangerous content in INJECT tag', {
        selector,
        content,
        errors: contentErrors,
      });
      return { code: '', errors, warnings };
    }

    // Additional validation - no script tags or dangerous attributes
    if (/<script/i.test(content) || /on\w+\s*=/i.test(content)) {
      errors.push({
        type: 'security',
        message:
          'Script tags and event handlers are not allowed in INJECT content',
        tag: 'INJECT',
      });
      return { code: '', errors, warnings };
    }

    // Content is assigned through textContent, so it never reaches an HTML
    // parser — no entity escaping needed, just safe JS string embedding.
    const escapedSelector = SecurityValidator.jsStringLiteral(selector);
    const escapedContent = SecurityValidator.jsStringLiteral(content);

    warnings.push({
      message: 'INJECT tag poses security risks. Content has been sanitized.',
      tag: 'INJECT',
    });

    // Generate safer code using textContent instead of innerHTML
    const code = `
      try {
        const injectElements = document.querySelectorAll(${escapedSelector});
        if (injectElements.length === 0) {
          console.warn('No elements found for selector: ${escapedSelector}');
        }
        injectElements.forEach(element => {
          // Using textContent for security - no HTML parsing
          element.textContent = ${escapedContent};
        });
      } catch (error) {
        console.error('INJECT operation failed:', error);
      }
    `;

    CompilerLogger.logSecurityIssue('INJECT tag used (security risk)', {
      selector,
      contentLength: content.length,
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Inject tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'INJECT',
    };

    CompilerLogger.logCompilerError('Inject tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
