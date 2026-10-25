import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { StateDirective } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { SourceElement } from '../source-dom';

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
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith } = handlerDiagnostics('DERIVE');

  try {
    const name = element.getAttribute('name');
    const expr = element.getAttribute('expr')?.trim();

    if (!name) {
      return fail('DERIVE tag requires a name attribute');
    }

    if (!expr) {
      return fail('DERIVE tag requires an expr attribute');
    }

    const path = validateStatePath(name);
    if (!path) {
      return fail(`Invalid derived state path: ${name}`);
    }

    const exprErrors = SecurityValidator.validateContent(expr);
    if (exprErrors.length > 0) {
      return failWith(exprErrors);
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
      value: handlerScope(options).expression(expr),
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
