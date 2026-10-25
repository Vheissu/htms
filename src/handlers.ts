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
import { handleDeriveTag } from './tags/derive';
import { handleEmitTag } from './tags/emit';
import {
  TagHandler,
  TagHandlerOptions,
  HandlerResult,
  CompilerError,
} from './types';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';
import { isTemplateElement } from './component/template-utils';
import { addNodeLocations } from './diagnostics';
import { SourceElement } from './source-dom';

const ALLOWED_STANDARD_ELEMENTS = new Set([
  'INPUT',
  'BUTTON',
  'UL',
  'LI',
  'DIV',
  'SPAN',
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'STRONG',
  'EM',
  'I',
  'B',
  'SMALL',
  'MARK',
  'CODE',
  'PRE',
  'A',
  'IMG',
  'FORM',
  'LABEL',
  'SELECT',
  'OPTION',
  'TEXTAREA',
  'FIELDSET',
  'LEGEND',
  'DATALIST',
  'OUTPUT',
  'PROGRESS',
  'METER',
  'OL',
  'DL',
  'DT',
  'DD',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
  'NAV',
  'HEADER',
  'FOOTER',
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'MAIN',
  'FIGURE',
  'FIGCAPTION',
  'AUDIO',
  'VIDEO',
  'BLOCKQUOTE',
  'CITE',
  'TIME',
  'DETAILS',
  'SUMMARY',
  'CANVAS',
  'HR',
  'BR',
  'STYLE',
  'LINK',
  'META',
]);

const HANDLERS_MAPPING = new Map<string, TagHandler>([
  ['PRINT', handlePrintTag],
  ['REPEAT', handleRepeatTag],
  ['VAR', handleVarTag],
  ['IF', handleIfElseTags],
  ['FUNCTION', handleFunctionTag],
  ['CALL', handleCallTag],
  ['SWITCH', handleSwitchTag],
  ['WHILE', handleWhileTag],
  ['OBJECT', handleObjectTag],
  ['ARRAY', handleArrayTag],
  ['COMMENT', handleCommentTag],
  ['EVENT', handleEventTag],
  ['INJECT', handleInjectTag],
  ['SET', handleSetTag],
  ['SPLICE', handleSpliceTag],
  ['PUSH', handlePushTag],
  ['SETPROP', handleSetPropTag],
  ['TOGGLE', handleToggleTag],
  ['SHOW', handleShowTag],
  ['BIND', handleBindTag],
  ['SETATTR', handleSetAttrTag],
  ['APPEND', handleAppendTag],
  ['KEYEDLIST', handleKeyedListTag],
  ['SUBMIT', handleSubmitTag],
  ['EFFECT', handleEffectTag],
  ['FETCH', handleFetchTag],
  ['CLASS', handleClassTag],
  ['STYLE', handleStyleTag],
  ['MODEL', handleModelTag],
  ['DERIVE', handleDeriveTag],
  ['EMIT', handleEmitTag],
]);

type ConsumableElement = SourceElement & { __htmsConsumed?: boolean };

export function handleElement(
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult {
  try {
    // Validate element
    if (!element || !element.tagName) {
      return {
        code: '',
        errors: [
          {
            type: 'validation',
            message: 'Invalid element: missing tagName',
          },
        ],
        warnings: [],
      };
    }

    if ((element as ConsumableElement).__htmsConsumed) {
      return { code: '', errors: [], warnings: [] };
    }

    const tagName = element.tagName.toUpperCase();

    CompilerLogger.logDebug('Processing element', {
      tagName,
      hasAttributes: element.attributes.length > 0,
      hasChildren: element.children.length > 0,
    });

    const handler = HANDLERS_MAPPING.get(tagName);
    // <style selector|prop|name> is the STYLE directive, not a stylesheet.
    const preferCustom =
      tagName === 'STYLE' &&
      (element.hasAttribute('selector') ||
        element.hasAttribute('prop') ||
        element.hasAttribute('name'));

    if (isStandardHtmlElement(element) && !preferCustom) {
      return handleHtmlElement(element, options);
    }

    if (!handler) {
      const suggestion = suggestTagName(tagName);
      const error: CompilerError = {
        type: 'validation',
        message: `Unsupported tag: ${tagName}`,
        tag: tagName,
        hint: suggestion
          ? `Did you mean <${suggestion.toLowerCase()}>?`
          : undefined,
      };

      CompilerLogger.logValidationError('Unsupported tag encountered', {
        tagName,
        availableTags: Array.from(HANDLERS_MAPPING.keys()),
      });

      return {
        code: '',
        errors: addNodeLocations([error], element),
        warnings: [],
      };
    }

    // Pre-process security validation for custom tags
    const securityErrors = validateElementSecurity(element);
    if (securityErrors.length > 0) {
      CompilerLogger.logSecurityIssue('Element security validation failed', {
        tagName,
        errors: securityErrors,
      });

      if (options.strictMode) {
        return {
          code: '',
          errors: addNodeLocations(securityErrors, element),
          warnings: [],
        };
      } else {
        // In non-strict mode, log warnings but continue
        return {
          code: '',
          errors: [],
          warnings: addNodeLocations(
            securityErrors.map((error) => ({
              message: error.message,
              tag: tagName,
            })),
            element
          ),
        };
      }
    }

    const result = handler(element, options);

    // Note: Security is enforced on inputs and final AST (in parse phase).
    // Avoid content-based scanning of generated code to reduce false positives.

    CompilerLogger.logDebug('Element processing completed', {
      tagName,
      success: result.errors.length === 0,
      codeLength: result.code.length,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
    });

    addNodeLocations(result.errors, element);
    addNodeLocations(result.warnings, element);
    return result;
  } catch (error) {
    const handlerError: CompilerError = {
      type: 'runtime',
      message: `Handler execution failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: element.tagName,
    };

    CompilerLogger.logCompilerError('Handler execution error', {
      tagName: element.tagName,
      error: handlerError.message,
    });

    return {
      code: '',
      errors: addNodeLocations([handlerError], element),
      warnings: [],
    };
  }
}

function editDistance(left: string, right: string): number {
  let previous = new Map<number, number>();
  for (let index = 0; index <= right.length; index += 1) {
    previous.set(index, index);
  }

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Map<number, number>();
    current.set(0, leftIndex);

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left.charAt(leftIndex - 1) === right.charAt(rightIndex - 1) ? 0 : 1;
      const deletion = (previous.get(rightIndex) ?? 0) + 1;
      const insertion = (current.get(rightIndex - 1) ?? 0) + 1;
      const substitution =
        (previous.get(rightIndex - 1) ?? 0) + substitutionCost;
      current.set(rightIndex, Math.min(deletion, insertion, substitution));
    }

    previous = current;
  }

  return previous.get(right.length) ?? Math.max(left.length, right.length);
}

function suggestTagName(tagName: string): string | null {
  const normalized = tagName.toUpperCase();
  let closest: { tag: string; distance: number } | null = null;

  for (const candidate of getAllowedTags()) {
    const distance = editDistance(normalized, candidate);
    if (!closest || distance < closest.distance) {
      closest = { tag: candidate, distance };
    }
  }

  if (!closest) {
    return null;
  }

  const threshold = Math.max(1, Math.floor(normalized.length / 3));
  return closest.distance <= threshold ? closest.tag : null;
}

export function isStandardHtmlElement(element: SourceElement): boolean {
  return (
    ALLOWED_STANDARD_ELEMENTS.has(element.tagName.toUpperCase()) ||
    isTemplateElement(element)
  );
}

function validateElementSecurity(element: SourceElement): CompilerError[] {
  const errors: CompilerError[] = [];

  // Validate attributes
  for (const attr of Array.from(element.attributes)) {
    const attrErrors = SecurityValidator.validateHtmlAttribute(
      attr.name,
      attr.value
    );
    errors.push(...attrErrors);
  }

  // Validate text content
  if (element.textContent) {
    const contentErrors = SecurityValidator.validateContent(
      element.textContent
    );
    errors.push(...contentErrors);
  }

  // Check for dangerous nesting patterns
  if (element.children.length > 100) {
    errors.push({
      type: 'security',
      message: 'Element has too many children (potential DoS)',
      tag: element.tagName,
    });
  }

  return errors;
}

function getAllowedTags(): string[] {
  return [
    ...Array.from(HANDLERS_MAPPING.keys()),
    ...Array.from(ALLOWED_STANDARD_ELEMENTS),
  ];
}
