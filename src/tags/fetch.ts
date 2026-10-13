import * as acorn from 'acorn';
import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { handlerScope } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';
import { getNodeLocation } from '../diagnostics';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_PARSERS = new Set([
  'json',
  'text',
  'blob',
  'arraybuffer',
  'formdata',
]);
const ALLOWED_CREDENTIALS = new Set(['omit', 'same-origin', 'include']);

let fetchCounter = 0;

// Location-based ids keep compiled output deterministic; the counter is a
// fallback for elements parsed without node locations (unit tests, DOM
// fragments created directly).
function stableId(prefix: string, element: Element): string {
  const location = getNodeLocation(element);
  if (location) {
    return `${prefix}_${location.line}_${location.column}`;
  }
  return `${prefix}_${++fetchCounter}`;
}

// `url` accepts a JS expression (e.g. `'/api'` or `this.endpoint`). When the
// attribute does not parse as an expression, treat it as a literal URL so
// `url="/api"` produces fetch('/api') instead of a broken regex literal.
function expressionOrLiteral(
  value: string,
  isReference?: (root: string) => boolean
): string {
  // A bare word such as url="health" is a relative URL unless it names a
  // component field.
  if (
    isReference &&
    SecurityValidator.isJavaScriptPath(value) &&
    value.split('.')[0] !== 'this' &&
    !isReference(value.split('.')[0])
  ) {
    return SecurityValidator.jsStringLiteral(value);
  }
  try {
    const node = acorn.parseExpressionAt(value, 0, { ecmaVersion: 'latest' });
    if (value.slice(node.end).trim() !== '') {
      return SecurityValidator.jsStringLiteral(value);
    }
    return value;
  } catch {
    return SecurityValidator.jsStringLiteral(value);
  }
}

function validateStatePath(path: string): string[] | null {
  if (!path) {
    return null;
  }
  const segments = path.split('.');
  if (segments.length === 0) {
    return null;
  }
  for (const segment of segments) {
    const errors = SecurityValidator.validateJavaScriptIdentifier(segment);
    if (errors.length > 0) {
      return null;
    }
  }
  return segments;
}

function buildComponentAssignment(
  path: string[],
  valueExpression: string
): string {
  if (path.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push('if (!owner) { return; }');
  lines.push('var target = owner;');
  for (const segment of path.slice(0, -1)) {
    lines.push(
      `if (target['${segment}'] == null || typeof target['${segment}'] !== 'object') { target['${segment}'] = {}; }`
    );
    lines.push(`target = target['${segment}'];`);
  }
  const [lastSegment] = [...path].reverse();
  lines.push(`target['${lastSegment}'] = ${valueExpression};`);
  return lines.join('\n');
}

function buildGlobalAssignment(
  path: string[],
  valueExpression: string
): string {
  if (path.length === 0) {
    return '';
  }
  return `${path.join('.')} = ${valueExpression};`;
}

function buildAssignment(
  path: string[] | null,
  valueExpression: string,
  isComponent: boolean
): string {
  if (!path || path.length === 0) {
    return '';
  }
  return isComponent
    ? buildComponentAssignment(path, valueExpression)
    : buildGlobalAssignment(path, valueExpression);
}

export const handleFetchTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const urlExpr = element.getAttribute('url');
    const methodAttr = (element.getAttribute('method') || 'GET').toUpperCase();
    const intoAttr = element.getAttribute('into');
    const errorAttr = element.getAttribute('error');
    const loadingAttr = element.getAttribute('loading');
    const bodyAttr = element.getAttribute('body');
    const headersAttr = element.getAttribute('headers');
    const parseAttr = (element.getAttribute('parse') || 'json').toLowerCase();
    const credentialsAttr = element.getAttribute('credentials');
    const whenAttr = element.getAttribute('when');
    const depsAttr = element.getAttribute('deps');
    const immediateAttr = element.getAttribute('immediate');
    const onceAttr = element.getAttribute('once');

    if (!urlExpr) {
      errors.push({
        type: 'validation',
        message: 'FETCH requires url attribute',
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_METHODS.has(methodAttr)) {
      errors.push({
        type: 'validation',
        message: `Unsupported HTTP method: ${methodAttr}. Allowed: ${Array.from(ALLOWED_METHODS).join(', ')}`,
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_PARSERS.has(parseAttr)) {
      errors.push({
        type: 'validation',
        message: `Unsupported parser: ${parseAttr}. Allowed: ${Array.from(ALLOWED_PARSERS).join(', ')}`,
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    if (credentialsAttr && !ALLOWED_CREDENTIALS.has(credentialsAttr)) {
      errors.push({
        type: 'validation',
        message: `Invalid credentials value: ${credentialsAttr}`,
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    const urlErrors = SecurityValidator.validateContent(urlExpr);
    if (urlErrors.length > 0) {
      errors.push(
        ...urlErrors.map((error) => ({
          ...error,
          tag: 'FETCH',
          message: `Invalid url expression: ${urlExpr}`,
        }))
      );
      return { code: '', errors, warnings };
    }

    if (bodyAttr) {
      const bodyErrors = SecurityValidator.validateContent(bodyAttr);
      if (bodyErrors.length > 0) {
        errors.push(
          ...bodyErrors.map((error) => ({
            ...error,
            tag: 'FETCH',
            message: `Invalid body expression: ${bodyAttr}`,
          }))
        );
        return { code: '', errors, warnings };
      }
      if (methodAttr === 'GET') {
        warnings.push({
          message:
            'HTTP GET with body attribute may be ignored by some browsers',
          tag: 'FETCH',
        });
      }
    }

    if (headersAttr) {
      const headersErrors = SecurityValidator.validateContent(headersAttr);
      if (headersErrors.length > 0) {
        errors.push(
          ...headersErrors.map((error) => ({
            ...error,
            tag: 'FETCH',
            message: `Invalid headers expression: ${headersAttr}`,
          }))
        );
        return { code: '', errors, warnings };
      }
    }

    if (whenAttr) {
      const whenErrors = SecurityValidator.validateContent(whenAttr);
      if (whenErrors.length > 0) {
        errors.push(
          ...whenErrors.map((error) => ({
            ...error,
            tag: 'FETCH',
            message: `Invalid condition: ${whenAttr}`,
          }))
        );
        return { code: '', errors, warnings };
      }
    }

    const intoPath = validateStatePath(intoAttr ?? '');
    if (intoAttr && !intoPath) {
      errors.push({
        type: 'validation',
        message: `Invalid into path: ${intoAttr}`,
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    const errorPath = validateStatePath(errorAttr ?? '');
    if (errorAttr && !errorPath) {
      errors.push({
        type: 'validation',
        message: `Invalid error path: ${errorAttr}`,
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    const loadingPath = validateStatePath(loadingAttr ?? '');
    if (loadingAttr && !loadingPath) {
      errors.push({
        type: 'validation',
        message: `Invalid loading path: ${loadingAttr}`,
        tag: 'FETCH',
      });
      return { code: '', errors, warnings };
    }

    const scope = handlerScope(options);
    const scoped = (expression: string | null): string | null =>
      expression ? scope.expression(expression, ['owner']) : expression;
    const urlCode = scope.expression(
      expressionOrLiteral(urlExpr, scope.isReference),
      ['owner']
    );
    const bodyCode = scoped(bodyAttr);
    const headersCode = scoped(headersAttr);
    const whenCode = scoped(whenAttr);
    const dependencySet = new Set<string>();
    dependencySet.add(urlCode);
    if (bodyCode) dependencySet.add(bodyCode);
    if (headersCode) dependencySet.add(headersCode);
    if (whenCode) dependencySet.add(whenCode);

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
              tag: 'FETCH',
              message: `Invalid dependency: ${dep}`,
            }))
          );
          return { code: '', errors, warnings };
        }
        dependencySet.add(scope.expression(dep, ['owner']));
      }
    }

    const dependencies = Array.from(dependencySet);
    const immediate = immediateAttr
      ? immediateAttr.toLowerCase() !== 'false'
      : true;
    const once = onceAttr ? onceAttr.toLowerCase() === 'true' : false;
    const fetchId = stableId('__fetch', element);
    const runtime = ensureRuntime();
    const isComponent = !!options.componentContext;

    const depsCode =
      dependencies.length > 0
        ? `[${dependencies.map((dep) => `() => (${dep})`).join(', ')}]`
        : '[]';

    const requestInitEntries: string[] = [`method: '${methodAttr}'`];
    if (headersCode) {
      requestInitEntries.push(`headers: ${headersCode}`);
    }
    if (bodyCode) {
      requestInitEntries.push(`body: ${bodyCode}`);
    }
    if (credentialsAttr) {
      requestInitEntries.push(`credentials: '${credentialsAttr}'`);
    }

    const initLiteral =
      requestInitEntries.length > 0
        ? `{
            ${requestInitEntries.join(',\n            ')}
          }`
        : `{}`;

    const parserLine = ((): string => {
      switch (parseAttr) {
        case 'text':
          return 'const data = await response.text();';
        case 'blob':
          return 'const data = await response.blob();';
        case 'arraybuffer':
          return 'const data = await response.arrayBuffer();';
        case 'formdata':
          return 'const data = await response.formData();';
        case 'json':
        default:
          return 'const data = await response.json();';
      }
    })();

    const assignData = buildAssignment(intoPath ?? null, 'data', isComponent);
    const assignErrorClear = errorPath
      ? buildAssignment(errorPath, 'null', isComponent)
      : '';
    const errorMessageExpr =
      '(error instanceof Error && error.message) ? error.message : String(error)';
    const assignError = buildAssignment(
      errorPath,
      errorMessageExpr,
      isComponent
    );
    const setLoadingTrue = buildAssignment(loadingPath, 'true', isComponent);
    const setLoadingFalse = buildAssignment(loadingPath, 'false', isComponent);

    const guardExpression = whenCode ? `(${whenCode})` : 'true';

    // Arrow functions keep `this` bound to the component, so url, body and
    // headers expressions can read component fields.
    const registrationCode = `((owner) => {
        if (typeof window !== 'undefined' && window.__HTMS_SSR__) { return; }
        var runtime = typeof window !== 'undefined' ? window.__htms : null;
        if (!runtime) { return; }
        runtime.registerEffect({
          owner: owner,
          id: '${fetchId}',
          deps: ${depsCode},
          immediate: ${immediate ? 'true' : 'false'},
          once: ${once ? 'true' : 'false'},
          run: () => {
            var shouldRun = ${guardExpression};
            if (!shouldRun) {
              return function(){};
            }
            var controller = (typeof AbortController === 'function') ? new AbortController() : null;
            var aborted = false;
${setLoadingTrue ? `            ${setLoadingTrue.replace(/\n/g, '\n            ')}\n` : ''}
${assignErrorClear ? `            ${assignErrorClear.replace(/\n/g, '\n            ')}\n` : ''}
${setLoadingTrue || assignErrorClear ? `            if (owner && typeof owner.requestUpdate === 'function') {\n              owner.requestUpdate();\n            }\n` : ''}            var init = ${initLiteral};
            if (init.body !== undefined && init.body !== null && typeof init.body === 'object' &&
                Object.getPrototypeOf(init.body) !== null &&
                (Array.isArray(init.body) || Object.getPrototypeOf(init.body) === Object.prototype)) {
              init.body = JSON.stringify(init.body);
              var headers = new Headers(init.headers || {});
              if (!headers.has('Content-Type')) {
                headers.set('Content-Type', 'application/json');
              }
              init.headers = headers;
            }
            if (controller && typeof controller.signal !== 'undefined') {
              init.signal = controller.signal;
            }
            var execute = async () => {
              try {
                const response = await fetch(${urlCode}, init);
                if (!response.ok) {
                  throw new Error('Request failed with status ' + response.status);
                }
                ${parseAttr === 'json' ? `const data = response.status === 204 ? null : await response.json();` : parserLine}
                if (aborted) { return; }
${assignData ? `                ${assignData.replace(/\n/g, '\n                ')}\n` : ''}
${assignErrorClear ? `                ${assignErrorClear.replace(/\n/g, '\n                ')}\n` : ''}
              } catch (error) {
                // A superseded or disconnected request must not overwrite the
                // state owned by its replacement.
                if (aborted) { return; }
${assignError ? `                ${assignError.replace(/\n/g, '\n                ')}\n` : ''}
                console.error('FETCH request failed:', error);
              } finally {
                if (!aborted) {
${setLoadingFalse ? `                  ${setLoadingFalse.replace(/\n/g, '\n                  ')}\n` : ''}
                  if (runtime) {
                    runtime.notify();
                  }
                  if (owner && typeof owner.requestUpdate === 'function') {
                    owner.requestUpdate();
                  } else if (owner && typeof owner.render === 'function') {
                    owner.render();
                  }
                }
              }
            };
            execute();
            return function(){
              aborted = true;
              if (controller && typeof controller.abort === 'function') {
                controller.abort();
              }
            };
          }
        });
      })(${isComponent ? 'this' : 'null'});`;
    const code = `${runtime}
      ${registrationCode}`;

    CompilerLogger.logInfo('Generated fetch effect', {
      id: fetchId,
      method: methodAttr,
      hasBody: !!bodyAttr,
      parse: parseAttr,
    });

    return {
      code,
      errors,
      warnings,
      component: isComponent
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
      errors: [{ type: 'runtime', message: String(error), tag: 'FETCH' }],
      warnings,
    };
  }
};
