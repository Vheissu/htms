import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import {
  DirectiveNode,
  EventDirective,
  EventModifiers,
} from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handleElement } from '../handlers';

const KNOWN_EVENT_TYPES = new Set([
  'click',
  'dblclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'mousemove',
  'wheel',
  'keydown',
  'keyup',
  'keypress',
  'focus',
  'blur',
  'focusin',
  'focusout',
  'change',
  'input',
  'submit',
  'reset',
  'load',
  'unload',
  'resize',
  'scroll',
  'error',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointerover',
  'pointerout',
  'touchstart',
  'touchend',
  'touchmove',
  'touchcancel',
  'dragstart',
  'dragend',
  'dragover',
  'dragenter',
  'dragleave',
  'drop',
  'animationstart',
  'animationend',
  'animationiteration',
  'transitionend',
  'toggle',
  'select',
  'slotchange',
]);

// Custom element/component event names: identifiers, dashes, dots and
// colons (e.g. "todo-added", "value-changed", "app:save").
const CUSTOM_EVENT_TYPE = /^[a-zA-Z][a-zA-Z0-9_.:-]*$/;

const KEYBOARD_EVENTS = new Set(['keydown', 'keyup', 'keypress']);

const SAFE_ACTIONS = new Set([
  'console.log',
  'console.info',
  'console.warn',
  'console.error',
  'alert',
  'confirm',
  'prompt',
]);

function parseBooleanModifier(
  element: Element,
  name: string
): boolean | undefined {
  const raw = element.getAttribute(name);
  if (raw === null) {
    return undefined;
  }
  return raw.trim().toLowerCase() !== 'false';
}

export const handleEventTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    const type = element.getAttribute('type');
    const action = element.getAttribute('action');

    if (!target || !type || (!action && element.children.length === 0)) {
      errors.push({
        type: 'validation',
        message: 'EVENT requires target and type, plus action or child tags',
        tag: 'EVENT',
      });
      return { code: '', errors, warnings };
    }

    // Validate event type: known DOM events or a well-formed custom name
    // so components can listen for events emitted via <emit>.
    if (!KNOWN_EVENT_TYPES.has(type) && !CUSTOM_EVENT_TYPE.test(type)) {
      errors.push({
        type: 'validation',
        message: `Invalid event type: ${type}`,
        tag: 'EVENT',
      });
      return { code: '', errors, warnings };
    }

    if (!SecurityValidator.isAllowedSelector(target)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector format for target',
        tag: 'EVENT',
      });
      return { code: '', errors, warnings };
    }

    const modifiers: EventModifiers = {};
    const prevent = parseBooleanModifier(element, 'prevent');
    if (prevent !== undefined) modifiers.prevent = prevent;
    const stop = parseBooleanModifier(element, 'stop');
    if (stop !== undefined) modifiers.stop = stop;
    const once = parseBooleanModifier(element, 'once');
    if (once !== undefined) modifiers.once = once;
    const passive = parseBooleanModifier(element, 'passive');
    if (passive !== undefined) modifiers.passive = passive;

    const debounceAttr = element.getAttribute('debounce');
    if (debounceAttr !== null) {
      const parsed = Number(debounceAttr);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors.push({
          type: 'validation',
          message: `Invalid debounce value: ${debounceAttr}. Expected milliseconds.`,
          tag: 'EVENT',
        });
        return { code: '', errors, warnings };
      }
      modifiers.debounceMs = parsed;
    }

    const keyAttr = element.getAttribute('key');
    if (keyAttr !== null) {
      if (!KEYBOARD_EVENTS.has(type)) {
        warnings.push({
          message: `key modifier only applies to keyboard events, not "${type}"`,
          tag: 'EVENT',
        });
      } else {
        modifiers.key = keyAttr;
      }
    }

    let bodyCode = '';
    const nestedDirectives: DirectiveNode[] = [];
    const isComponentContext =
      options.parentContext === 'component' || options.componentContext;
    if (element.children.length > 0) {
      for (const child of Array.from(element.children)) {
        const r = handleElement(child, options);
        if (r.errors.length > 0) {
          errors.push(...r.errors.map((error) => ({ ...error, tag: 'EVENT' })));
          if (options.strictMode) return { code: '', errors, warnings };
        }
        if (r.warnings.length > 0) warnings.push(...r.warnings);
        if (r.component?.directives) {
          nestedDirectives.push(...r.component.directives);
        }
        const hasComponentDirective = !!(
          r.component &&
          r.component.directives &&
          r.component.directives.length > 0
        );
        if (!(isComponentContext && hasComponentDirective) && r.code) {
          bodyCode += r.code + '\n';
        }
      }
    } else if (action) {
      // Security validation of action
      const actionErrors = SecurityValidator.validateContent(action);
      if (actionErrors.length > 0) {
        errors.push(
          ...actionErrors.map((error) => ({ ...error, tag: 'EVENT' }))
        );
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }

      // In strict mode, only allow whitelisted actions
      if (options.strictMode) {
        const actionFunction = action.split('(')[0].trim();
        if (!SAFE_ACTIONS.has(actionFunction)) {
          errors.push({
            type: 'security',
            message: `Action not in whitelist: ${actionFunction}. Safe actions: ${Array.from(SAFE_ACTIONS).join(', ')}`,
            tag: 'EVENT',
          });
          return { code: '', errors, warnings };
        }
      }

      // Validate action syntax - must be a function call
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*\s*\([^)]*\)$/.test(action.trim())) {
        errors.push({
          type: 'validation',
          message:
            'Action must be a function call (e.g., "console.log(\'Hello\')")',
          tag: 'EVENT',
        });
        return { code: '', errors, warnings };
      }
      bodyCode = `${action}`;
    }

    const escapedTarget = SecurityValidator.jsStringLiteral(target);
    const escapedType = SecurityValidator.jsStringLiteral(type);
    const preventCall =
      modifiers.prevent === true
        ? 'event.preventDefault && event.preventDefault();'
        : '';
    const stopCall =
      modifiers.stop === true
        ? 'event.stopPropagation && event.stopPropagation();'
        : '';

    // Generate safe event handler with error handling
    const code = isComponentContext
      ? ''
      : `
      try {
        const eventTargets = document.querySelectorAll(${escapedTarget});
        if (eventTargets.length === 0) {
          console.warn('No elements found for event target: ${escapedTarget}');
        }
        eventTargets.forEach(element => {
          element.addEventListener(${escapedType}, function(event) {
            try {
              ${preventCall}
              ${stopCall}
${(bodyCode || '')
  .split('\n')
  .filter(Boolean)
  .map((l) => '              ' + l)
  .join('\n')}
            } catch (error) {
              console.error('Event handler error:', error);
            }
          });
        });
      } catch (error) {
        console.error('Event setup failed:', error);
      }
    `;

    if (action && !SAFE_ACTIONS.has(action.split('(')[0].trim())) {
      warnings.push({
        message: `Event action may pose security risks: ${action}`,
        tag: 'EVENT',
      });

      CompilerLogger.logSecurityIssue('Potentially dangerous event action', {
        target,
        type,
        action,
      });
    }

    CompilerLogger.logDebug('Generated event handler', {
      target,
      type,
      action,
      modifiers,
      isSafeAction: action
        ? SAFE_ACTIONS.has(action.split('(')[0].trim())
        : true,
    });

    const eventDirective: EventDirective = {
      kind: 'event',
      selector: target,
      eventType: type,
      body: bodyCode
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .filter((line) => line.trim().length > 0),
      directives: nestedDirectives.length > 0 ? nestedDirectives : undefined,
      modifiers:
        Object.keys(modifiers).length > 0 ? modifiers : undefined,
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [eventDirective],
      },
    };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Event tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'EVENT',
    };

    CompilerLogger.logCompilerError('Event tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
