import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

function validateStatePath(path: string): string[] | null {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  for (const part of parts) {
    const errors = SecurityValidator.validateJavaScriptIdentifier(part);
    if (errors.length > 0) {
      return null;
    }
  }

  return parts;
}

export const handleDeriveTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const name = element.getAttribute('name');
    const expr = element.getAttribute('expr')?.trim();

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'DERIVE tag requires a name attribute',
        tag: 'DERIVE',
      });
      return { code: '', errors, warnings };
    }

    if (!expr) {
      errors.push({
        type: 'validation',
        message: 'DERIVE tag requires an expr attribute',
        tag: 'DERIVE',
      });
      return { code: '', errors, warnings };
    }

    const path = validateStatePath(name);
    if (!path) {
      errors.push({
        type: 'validation',
        message: `Invalid derived state path: ${name}`,
        tag: 'DERIVE',
      });
      return { code: '', errors, warnings };
    }

    const exprErrors = SecurityValidator.validateContent(expr);
    if (exprErrors.length > 0) {
      errors.push(...exprErrors.map((error) => ({ ...error, tag: 'DERIVE' })));
      return { code: '', errors, warnings };
    }

    const isComponentContext = options.parentContext === 'component';
    const code = isComponentContext ? '' : `${name} = ${expr};`;

    CompilerLogger.logDebug('Generated derived state', {
      target: name,
      expression: expr,
    });

    const stateDirective: StateDirective = {
      kind: 'state',
      mode: 'derive',
      path,
      value: expr,
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [stateDirective],
      },
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'DERIVE' }],
      warnings,
    };
  }
};
