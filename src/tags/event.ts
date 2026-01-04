import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { DirectiveNode, EventDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

const ALLOWED_EVENT_TYPES = new Set([
  'click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout',
  'keydown', 'keyup', 'keypress', 'focus', 'blur', 'change', 'input', 'submit',
  'load', 'unload', 'resize', 'scroll'
]);

const SAFE_ACTIONS = new Set([
  'console.log', 'console.info', 'console.warn', 'console.error',
  'alert', 'confirm', 'prompt'
]);

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
        tag: 'EVENT'
      });
      return { code: '', errors, warnings };
    }

    // Validate event type
    if (!ALLOWED_EVENT_TYPES.has(type)) {
      errors.push({
        type: 'validation',
        message: `Invalid event type: ${type}. Allowed: ${Array.from(ALLOWED_EVENT_TYPES).join(', ')}`,
        tag: 'EVENT'
      });
      return { code: '', errors, warnings };
    }

    // Validate CSS selector
    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(target)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector format for target',
        tag: 'EVENT'
      });
      return { code: '', errors, warnings };
    }

    let bodyCode = '';
    const nestedDirectives: DirectiveNode[] = [];
    const isComponentContext = options.parentContext === 'component';
    if (element.children.length > 0) {
      for (const child of Array.from(element.children)) {
        const { handleElement } = require('../handlers');
        const r = handleElement(child, options);
        if (r.errors.length > 0) {
          errors.push(...r.errors.map((e: any) => ({ ...e, tag: 'EVENT' })));
          if (options.strictMode) return { code: '', errors, warnings };
        }
        if (r.warnings.length > 0) warnings.push(...r.warnings);
        if (r.component?.directives) {
          nestedDirectives.push(...r.component.directives);
        }
        const hasComponentDirective = !!(r.component && r.component.directives && r.component.directives.length > 0);
        if (!(isComponentContext && hasComponentDirective) && r.code) {
          bodyCode += r.code + '\n';
        }
      }
    } else if (action) {
      // Security validation of action
      const actionErrors = SecurityValidator.validateContent(action);
      if (actionErrors.length > 0) {
        errors.push(...actionErrors.map(error => ({ ...error, tag: 'EVENT' })));
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
            tag: 'EVENT'
          });
          return { code: '', errors, warnings };
        }
      }

      // Validate action syntax - must be a function call
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*\s*\([^)]*\)$/.test(action.trim())) {
        errors.push({
          type: 'validation',
          message: 'Action must be a function call (e.g., "console.log(\'Hello\')")',
          tag: 'EVENT'
        });
        return { code: '', errors, warnings };
      }
      bodyCode = `${action}`;
    }

    // Escape values for safe template generation
    const escapedTarget = SecurityValidator.escapeForTemplate(target);
    const escapedAction = action ? SecurityValidator.escapeForTemplate(action) : '';

    // Generate safe event handler with error handling
    const code = isComponentContext ? '' : `
      try {
        const eventTargets = document.querySelectorAll(\`${escapedTarget}\`);
        if (eventTargets.length === 0) {
          console.warn('No elements found for event target: ${escapedTarget}');
        }
        eventTargets.forEach(element => {
          element.addEventListener('${type}', function(event) {
            try {
${(bodyCode || '').split('\n').filter(Boolean).map(l => '              ' + l).join('\n')}
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
        tag: 'EVENT'
      });
      
      CompilerLogger.logSecurityIssue('Potentially dangerous event action', {
        target: escapedTarget,
        type,
        action: escapedAction
      });
    }

    CompilerLogger.logDebug('Generated event handler', {
      target: escapedTarget,
      type,
      action: escapedAction,
      isSafeAction: action ? SAFE_ACTIONS.has(action.split('(')[0].trim()) : true
    });

    const eventDirective: EventDirective = {
      kind: 'event',
      selector: target,
      eventType: type,
      body: bodyCode
        .split('\n')
        .map(line => line.replace(/\s+$/, ''))
        .filter(line => line.trim().length > 0),
      directives: nestedDirectives.length > 0 ? nestedDirectives : undefined
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [eventDirective]
      }
    };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Event tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'EVENT'
    };
    
    CompilerLogger.logCompilerError('Event tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};
