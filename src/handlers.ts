import { handleHtmlElement } from './html-element';
import { handleArrayTag } from './tags/array';
import { handleCallTag } from './tags/call';
import { handleCommentTag } from './tags/comment';
import { handleEventTag } from './tags/event';
import { handleFunctionTag } from './tags/function';
import { handleIfElseTags } from './tags/if-else';
import { handleInjectTag } from './tags/inject';
import { handleObjectTag } from './tags/object';
import { handlePrintTag } from './tags/print';
import { handleRepeatTag } from './tags/repeat';
import { handleSwitchTag } from './tags/switch';
import { handleVarTag } from './tags/var';
import { handleWhileTag } from './tags/while';
import { handleSetTag } from './tags/set';
import { handlePushTag } from './tags/push';
import { handleSetPropTag } from './tags/setprop';
import { handleToggleTag } from './tags/toggle';
import { handleBindTag } from './tags/bind';
import { handleSpliceTag } from './tags/splice';
import { handleShowTag } from './tags/show';
import { handleSetAttrTag } from './tags/setattr';
import { handleAppendTag } from './tags/append';
import { handleKeyedListTag } from './tags/keyed-list';
import { handleSubmitTag } from './tags/submit';
import { handleEffectTag } from './tags/effect';
import { handleFetchTag } from './tags/fetch';
import { handleClassTag } from './tags/class';
import { handleStyleTag } from './tags/style';
import { handleModelTag } from './tags/model';
import { TagHandler, TagHandlerOptions, HandlerResult, CompilerError } from './types';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';

const ALLOWED_STANDARD_ELEMENTS = new Set([
  'INPUT', 'BUTTON', 'UL', 'LI', 'DIV', 'SPAN', 'P', 'H1', 'H2', 'H3', 
  'H4', 'H5', 'H6', 'STRONG', 'EM', 'I', 'B', 'SMALL', 'MARK', 'CODE', 'PRE',
  'A', 'IMG', 'FORM', 'LABEL', 'SELECT', 'OPTION', 'TEXTAREA', 'FIELDSET',
  'LEGEND', 'DATALIST', 'OUTPUT', 'PROGRESS', 'METER', 'OL', 'DL', 'DT', 'DD',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'NAV', 'HEADER', 'FOOTER', 
  'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'FIGURE', 'FIGCAPTION', 'AUDIO', 'VIDEO',
  'BLOCKQUOTE', 'CITE', 'TIME', 'DETAILS', 'SUMMARY', 'CANVAS', 'HR', 'BR',
  'STYLE', 'LINK', 'META'
]);

const HANDLERS_MAPPING = {
  PRINT: handlePrintTag,
  REPEAT: handleRepeatTag,
  VAR: handleVarTag,
  IF: handleIfElseTags,
  FUNCTION: handleFunctionTag,
  CALL: handleCallTag,
  SWITCH: handleSwitchTag,
  WHILE: handleWhileTag,
  OBJECT: handleObjectTag,
  ARRAY: handleArrayTag,
  COMMENT: handleCommentTag,
  EVENT: handleEventTag,
  INJECT: handleInjectTag,
  SET: handleSetTag,
  SPLICE: handleSpliceTag,
  PUSH: handlePushTag,
  SETPROP: handleSetPropTag,
  TOGGLE: handleToggleTag,
  SHOW: handleShowTag,
  BIND: handleBindTag,
  SETATTR: handleSetAttrTag,
  APPEND: handleAppendTag,
  KEYEDLIST: handleKeyedListTag,
  SUBMIT: handleSubmitTag,
  EFFECT: handleEffectTag,
  FETCH: handleFetchTag,
  CLASS: handleClassTag,
  STYLE: handleStyleTag,
  MODEL: handleModelTag,
} satisfies Record<string, TagHandler>;

export function handleElement(
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult {
  try {
    // Validate element
    if (!element || !element.tagName) {
      return {
        code: '',
        errors: [{
          type: 'validation',
          message: 'Invalid element: missing tagName'
        }],
        warnings: []
      };
    }

    if ((element as any).__htmsConsumed) {
      return { code: '', errors: [], warnings: [] };
    }

    const tagName = element.tagName.toUpperCase();
    
    CompilerLogger.logDebug('Processing element', { 
      tagName, 
      hasAttributes: element.attributes.length > 0,
      hasChildren: element.children.length > 0
    });

    const hasHandler = Object.prototype.hasOwnProperty.call(HANDLERS_MAPPING, tagName);
    const preferCustom =
      tagName === 'STYLE' &&
      (element.hasAttribute('selector') ||
        element.hasAttribute('prop') ||
        element.hasAttribute('name'));

    // Check if it's a standard HTML element
    if (isStandardHtmlElement(element) && !(hasHandler && preferCustom)) {
      return handleHtmlElement(element, options);
    }

    // Check if it's a supported custom tag
    if (!hasHandler) {
      const error: CompilerError = {
        type: 'validation',
        message: `Unsupported tag: ${tagName}`,
        tag: tagName
      };
      
      CompilerLogger.logValidationError('Unsupported tag encountered', { 
        tagName,
        availableTags: Object.keys(HANDLERS_MAPPING)
      });

      return {
        code: '',
        errors: [error],
        warnings: []
      };
    }

    // Pre-process security validation for custom tags
    const securityErrors = validateElementSecurity(element);
    if (securityErrors.length > 0) {
      CompilerLogger.logSecurityIssue('Element security validation failed', {
        tagName,
        errors: securityErrors
      });
      
      if (options.strictMode) {
        return {
          code: '',
          errors: securityErrors,
          warnings: []
        };
      } else {
        // In non-strict mode, log warnings but continue
        return {
          code: '',
          errors: [],
          warnings: securityErrors.map(error => ({
            message: error.message,
            tag: tagName
          }))
        };
      }
    }

    // Execute the handler
    const handlerFunction = HANDLERS_MAPPING[tagName as keyof typeof HANDLERS_MAPPING];
    const result = handlerFunction(element, options);
    
    // Note: Security is enforced on inputs and final AST (in parse phase).
    // Avoid content-based scanning of generated code to reduce false positives.

    CompilerLogger.logDebug('Element processing completed', {
      tagName,
      success: result.errors.length === 0,
      codeLength: result.code.length,
      errorCount: result.errors.length,
      warningCount: result.warnings.length
    });

    return result;
    
  } catch (error) {
    const handlerError: CompilerError = {
      type: 'runtime',
      message: `Handler execution failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: element.tagName
    };

    CompilerLogger.logCompilerError('Handler execution error', {
      tagName: element.tagName,
      error: handlerError.message
    });

    return {
      code: '',
      errors: [handlerError],
      warnings: []
    };
  }
}

export function isStandardHtmlElement(element: Element): boolean {
  return ALLOWED_STANDARD_ELEMENTS.has(element.tagName.toUpperCase());
}

function validateElementSecurity(element: Element): CompilerError[] {
  const errors: CompilerError[] = [];
  
  // Validate attributes
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    const attrErrors = SecurityValidator.validateHtmlAttribute(attr.name, attr.value);
    errors.push(...attrErrors);
  }
  
  // Validate text content
  if (element.textContent) {
    const contentErrors = SecurityValidator.validateContent(element.textContent);
    errors.push(...contentErrors);
  }
  
  // Check for dangerous nesting patterns
  if (element.children.length > 100) {
    errors.push({
      type: 'security',
      message: 'Element has too many children (potential DoS)',
      tag: element.tagName
    });
  }
  
  return errors;
}

export function getAllowedTags(): string[] {
  return [...Object.keys(HANDLERS_MAPPING), ...Array.from(ALLOWED_STANDARD_ELEMENTS)];
}

export function isTagSupported(tagName: string): boolean {
  const upperTagName = tagName.toUpperCase();
  return HANDLERS_MAPPING.hasOwnProperty(upperTagName) || ALLOWED_STANDARD_ELEMENTS.has(upperTagName);
}
