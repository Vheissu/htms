import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { DirectiveNode } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

// Custom event names: a letter/underscore followed by letters, digits,
// underscores, hyphens or colons (e.g. "change", "todo:added", "value-changed").
const EVENT_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_:-]*$/;

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }
  return value.trim().toLowerCase() === 'true';
}

export const handleEmitTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, report, empty } = handlerDiagnostics('EMIT');

  try {
    const name = element.getAttribute('name') || element.getAttribute('event');
    const detail = element.getAttribute('detail')?.trim();

    if (!name) {
      return fail(
        'EMIT requires a name attribute (the event type to dispatch)'
      );
    }

    if (!EVENT_NAME_PATTERN.test(name)) {
      return fail(`Invalid event name: ${name}`);
    }

    let detailExpr = 'undefined';
    if (detail) {
      const detailErrors = SecurityValidator.validateContent(detail);
      if (detailErrors.length > 0) {
        report(detailErrors);
        if (options.strictMode) {
          return empty();
        }
      }
      detailExpr = handlerScope(options).expression(detail);
    }

    const bubbles = parseBoolean(element.getAttribute('bubbles'), true);
    // Components default to shadow DOM, so events must be composed to cross the
    // shadow boundary and reach listeners on the host's ancestors.
    const composed = parseBoolean(element.getAttribute('composed'), true);
    const cancelable = parseBoolean(element.getAttribute('cancelable'), false);

    const eventInit = `{ detail: ${detailExpr}, bubbles: ${bubbles}, composed: ${composed}, cancelable: ${cancelable} }`;
    const statement = `this.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, ${eventInit}));`;

    CompilerLogger.logDebug('Generated emit', {
      name,
      hasDetail: detailExpr !== 'undefined',
      bubbles,
      composed,
      cancelable,
    });

    const directive: DirectiveNode = {
      kind: 'statement',
      code: statement,
      emittedEventName: name,
    };
    const isComponentContext = options.parentContext === 'component';

    return {
      code: isComponentContext ? '' : statement,
      errors,
      warnings,
      component: {
        directives: [directive],
      },
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Emit tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'EMIT',
    };

    CompilerLogger.logCompilerError('Emit tag handler error', {
      error: runtimeError.message,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
