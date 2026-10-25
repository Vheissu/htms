import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';
import { handleElement } from '../handlers';
import { getNodeLocation } from '../diagnostics';
import { SourceElement } from '../source-dom';

let effectCounter = 0;

// Location-based ids keep compiled output deterministic; the counter is a
// fallback for elements parsed without node locations (unit tests, DOM
// fragments created directly).
function stableId(prefix: string, element: SourceElement): string {
  const location = getNodeLocation(element);
  if (location) {
    return `${prefix}_${location.line}_${location.column}`;
  }
  return `${prefix}_${++effectCounter}`;
}

function splitStatements(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function ensureTerminated(statement: string): string {
  const trimmed = statement.trim();
  if (trimmed.endsWith(';') || trimmed.endsWith('}') || trimmed.endsWith(')')) {
    return trimmed;
  }
  return `${trimmed};`;
}

export const handleEffectTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith, report, empty } =
    handlerDiagnostics('EFFECT');

  try {
    const runAttr = element.getAttribute('run')?.trim() ?? '';
    const cleanupAttr = element.getAttribute('cleanup')?.trim() ?? '';
    const depsAttr = element.getAttribute('deps');
    const immediateAttr = element.getAttribute('immediate');
    const onceAttr = element.getAttribute('once');

    const bodyStatements: string[] = [];

    const collectCode = (code: string): void => {
      for (const line of splitStatements(code)) {
        bodyStatements.push(line);
      }
    };

    // Process text and child nodes as effect body
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) {
        const text = node.textContent?.trim();
        if (!text) {
          continue;
        }
        const textErrors = SecurityValidator.validateContent(text);
        if (textErrors.length > 0) {
          report(textErrors);
          if (options.strictMode) {
            return empty();
          }
        }
        collectCode(text);
      } else if (node.nodeType === 1) {
        const child = node as SourceElement;
        const childOptions: TagHandlerOptions = {
          ...options,
          parentContext: 'effect',
        };
        const childResult: HandlerResult = handleElement(child, childOptions);
        if (childResult.errors.length > 0) {
          errors.push(
            ...childResult.errors.map((error) => ({ ...error, tag: 'EFFECT' }))
          );
          if (options.strictMode) {
            return empty();
          }
        }
        if (childResult.warnings.length > 0) {
          warnings.push(
            ...childResult.warnings.map((warning) => ({
              ...warning,
              tag: warning.tag ?? 'EFFECT',
            }))
          );
        }
        if (childResult.code) {
          collectCode(childResult.code);
        }
      }
    }

    if (runAttr) {
      const runErrors = SecurityValidator.validateContent(runAttr);
      if (runErrors.length > 0) {
        return failWith(runErrors);
      }
      collectCode(ensureTerminated(runAttr));
    }

    if (bodyStatements.length === 0) {
      return fail(
        'EFFECT requires body content via run attribute, text, or child tags'
      );
    }

    if (cleanupAttr) {
      const cleanupErrors = SecurityValidator.validateContent(cleanupAttr);
      if (cleanupErrors.length > 0) {
        return failWith(cleanupErrors);
      }
    }

    const dependencies: string[] = [];
    if (depsAttr) {
      for (const raw of depsAttr.split(',')) {
        const dep = raw.trim();
        if (!dep) {
          continue;
        }
        const depErrors = SecurityValidator.validateContent(dep);
        if (depErrors.length > 0) {
          errors.push(
            ...depErrors.map((error) => ({
              ...error,
              tag: 'EFFECT',
              message: `Invalid dependency expression: ${dep}`,
            }))
          );
          return empty();
        }
        dependencies.push(dep);
      }
    }

    const immediate = immediateAttr
      ? immediateAttr.toLowerCase() !== 'false'
      : true;
    const once = onceAttr ? onceAttr.toLowerCase() === 'true' : false;
    const effectId = stableId('__effect', element);
    const runtime = ensureRuntime();
    const ownerExpr = options.componentContext ? 'this' : 'null';
    const scope = handlerScope(options);
    const scopedDependencies = dependencies.map((dependency) =>
      scope.expression(dependency, ['owner'])
    );
    const scopedBody = scope
      .statements(bodyStatements.join('\n'), ['owner'])
      .split('\n');
    const scopedCleanup = cleanupAttr
      ? scope.statements(cleanupAttr, ['owner'])
      : '';

    const depsCode =
      scopedDependencies.length > 0
        ? `[${scopedDependencies.map((dep) => `() => (${dep})`).join(', ')}]`
        : '[]';

    const runBody = scopedBody.map((line) => `            ${line}`).join('\n');

    const cleanupBlock = scopedCleanup
      ? `
          cleanup: () => {
            try {
              ${scopedCleanup}
            } catch (error) {
              console.error('EFFECT cleanup failed:', error);
            }
          },`
      : '';

    // Arrow functions keep `this` bound to the component inside run, deps
    // and cleanup.
    const registrationCode = `((owner) => {
        if (typeof window !== 'undefined' && window.__HTMS_SSR__) { return; }
        var runtime = typeof window !== 'undefined' ? window.__htms : null;
        if (!runtime) { return; }
        runtime.registerEffect({
          owner: owner,
          id: '${effectId}',
          deps: ${depsCode},
          immediate: ${immediate ? 'true' : 'false'},
          once: ${once ? 'true' : 'false'},
          run: () => {
            try {
${runBody}
            } catch (error) {
              console.error('EFFECT run failed:', error);
            }
          },${cleanupBlock ? `\n${cleanupBlock.slice(1)}` : '\n'}
        });
      })(${ownerExpr});`;
    const code = `${runtime}
      ${registrationCode}`;

    CompilerLogger.logDebug('Generated effect', {
      id: effectId,
      dependencies: dependencies.length,
      immediate,
      once,
    });

    return {
      code,
      errors,
      warnings,
      component: options.componentContext
        ? {
            directives: [
              {
                kind: 'statement',
                code: registrationCode,
                requiresRuntime: true,
              },
            ],
          }
        : undefined,
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'EFFECT' }],
      warnings,
    };
  }
};
