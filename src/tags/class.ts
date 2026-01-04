import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { ClassDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

const ACTIONS = new Set(['add', 'remove', 'toggle']);

function parseClassNames(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map(name => name.trim())
    .filter(Boolean);
}

function isValidClassName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export const handleClassTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const selector = element.getAttribute('selector');
    const nameAttr = element.getAttribute('name') || '';
    const actionAttr = element.getAttribute('action')?.toLowerCase();
    const whenAttr = element.getAttribute('when') || element.getAttribute('condition');

    if (!selector || !nameAttr.trim()) {
      errors.push({
        type: 'validation',
        message: 'CLASS requires selector and name attributes',
        tag: 'CLASS'
      });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(selector)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector', tag: 'CLASS' });
      return { code: '', errors, warnings };
    }

    const classNames = parseClassNames(nameAttr);
    if (classNames.length === 0) {
      errors.push({ type: 'validation', message: 'CLASS name is empty', tag: 'CLASS' });
      return { code: '', errors, warnings };
    }

    for (const className of classNames) {
      if (!isValidClassName(className)) {
        errors.push({
          type: 'validation',
          message: `Invalid class name: ${className}`,
          tag: 'CLASS'
        });
        return { code: '', errors, warnings };
      }
    }

    let action = actionAttr || '';
    if (action && !ACTIONS.has(action)) {
      errors.push({
        type: 'validation',
        message: `Invalid action for CLASS: ${action}`,
        tag: 'CLASS'
      });
      return { code: '', errors, warnings };
    }

    if (!action) {
      action = whenAttr ? 'toggle' : 'add';
    }

    let condition: string | undefined;
    if (whenAttr) {
      const conditionErrors = SecurityValidator.validateContent(whenAttr);
      if (conditionErrors.length > 0) {
        errors.push(...conditionErrors.map(error => ({ ...error, tag: 'CLASS' })));
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }
      condition = whenAttr.trim();
    }

    const isComponentContext = options.parentContext === 'component';
    const selEsc = SecurityValidator.escapeForTemplate(selector);
    const classListLiteral = classNames.map(name => `"${name}"`).join(', ');
    const condExpr = condition ? `!!(${condition})` : '';

    const code = isComponentContext
      ? ''
      : `
      (function(){
        try {
          const targets = document.querySelectorAll(\`${selEsc}\`);
          targets.forEach(node => {
            const classes = [${classListLiteral}];
            classes.forEach(cls => {
              ${condition ? `node.classList.toggle(cls, ${condExpr});` : `node.classList.${action}(cls);`}
            });
          });
        } catch (error) {
          console.error('CLASS failed:', error);
        }
      })();`;

    const directive: ClassDirective = {
      kind: 'class',
      selector,
      classNames,
      action: action as 'add' | 'remove' | 'toggle',
      condition
    };

    CompilerLogger.logDebug('Generated class directive', {
      selector,
      classNames,
      action,
      hasCondition: !!condition
    });

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [directive]
      }
    };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'CLASS' }], warnings };
  }
};
