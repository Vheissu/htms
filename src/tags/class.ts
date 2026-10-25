import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { ClassDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

const ACTIONS = new Set(['add', 'remove', 'toggle']);

function parseClassNames(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function isValidClassName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}

export const handleClassTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, report, empty } = handlerDiagnostics('CLASS');

  try {
    const selector = element.getAttribute('selector');
    const nameAttr = element.getAttribute('name') || '';
    const actionAttr = element.getAttribute('action')?.toLowerCase();
    const whenAttr =
      element.getAttribute('when') || element.getAttribute('condition');

    if (!selector || !nameAttr.trim()) {
      return fail('CLASS requires selector and name attributes');
    }

    if (!SecurityValidator.isAllowedSelector(selector)) {
      return fail('Invalid CSS selector');
    }

    const classNames = parseClassNames(nameAttr);
    if (classNames.length === 0) {
      return fail('CLASS name is empty');
    }

    for (const className of classNames) {
      if (!isValidClassName(className)) {
        return fail(`Invalid class name: ${className}`);
      }
    }

    let action = actionAttr || '';
    if (action && !ACTIONS.has(action)) {
      return fail(`Invalid action for CLASS: ${action}`);
    }

    if (!action) {
      action = whenAttr ? 'toggle' : 'add';
    }

    let condition: string | undefined;
    if (whenAttr) {
      const conditionErrors = SecurityValidator.validateContent(whenAttr);
      if (conditionErrors.length > 0) {
        report(conditionErrors);
        if (options.strictMode) {
          return empty();
        }
      }
      condition = handlerScope(options).expression(whenAttr.trim());
    }

    const isComponentContext = options.parentContext === 'component';
    const selEsc = SecurityValidator.jsStringLiteral(selector);
    const classListLiteral = classNames
      .map((name) => SecurityValidator.jsStringLiteral(name))
      .join(', ');
    const condExpr = condition ? `!!(${condition})` : '';

    const code = isComponentContext
      ? ''
      : `
      (function(){
        try {
          const targets = document.querySelectorAll(${selEsc});
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
      condition,
    };

    CompilerLogger.logDebug('Generated class directive', {
      selector,
      classNames,
      action,
      hasCondition: !!condition,
    });

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [directive],
      },
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'CLASS' }],
      warnings,
    };
  }
};
