import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_PARSERS = new Set(['json', 'text', 'blob', 'arraybuffer', 'formdata']);
const ALLOWED_CREDENTIALS = new Set(['omit', 'same-origin', 'include']);

let fetchCounter = 0;

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

function buildComponentAssignment(path: string[], valueExpression: string): string {
  if (path.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push('if (!owner) { return; }');
  lines.push('var target = owner;');
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    lines.push(
      `if (target['${segment}'] == null || typeof target['${segment}'] !== 'object') { target['${segment}'] = {}; }`
    );
    lines.push(`target = target['${segment}'];`);
  }
  lines.push(`target['${path[path.length - 1]}'] = ${valueExpression};`);
  return lines.join('\n');
}

function buildGlobalAssignment(path: string[], valueExpression: string): string {
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
  return isComponent ? buildComponentAssignment(path, valueExpression) : buildGlobalAssignment(path, valueExpression);
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
      errors.push({ type: 'validation', message: 'FETCH requires url attribute', tag: 'FETCH' });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_METHODS.has(methodAttr)) {
      errors.push({
        type: 'validation',
        message: `Unsupported HTTP method: ${methodAttr}. Allowed: ${Array.from(ALLOWED_METHODS).join(', ')}`,
        tag: 'FETCH'
      });
      return { code: '', errors, warnings };
    }

    if (!ALLOWED_PARSERS.has(parseAttr)) {
      errors.push({
        type: 'validation',
        message: `Unsupported parser: ${parseAttr}. Allowed: ${Array.from(ALLOWED_PARSERS).join(', ')}`,
        tag: 'FETCH'
      });
      return { code: '', errors, warnings };
    }

    if (credentialsAttr && !ALLOWED_CREDENTIALS.has(credentialsAttr)) {
      errors.push({
        type: 'validation',
        message: `Invalid credentials value: ${credentialsAttr}`,
        tag: 'FETCH'
      });
      return { code: '', errors, warnings };
    }

    const urlErrors = SecurityValidator.validateContent(urlExpr);
    if (urlErrors.length > 0) {
      errors.push(...urlErrors.map(error => ({ ...error, tag: 'FETCH', message: `Invalid url expression: ${urlExpr}` })));
      return { code: '', errors, warnings };
    }

    if (bodyAttr) {
      const bodyErrors = SecurityValidator.validateContent(bodyAttr);
      if (bodyErrors.length > 0) {
        errors.push(...bodyErrors.map(error => ({ ...error, tag: 'FETCH', message: `Invalid body expression: ${bodyAttr}` })));
        return { code: '', errors, warnings };
      }
      if (methodAttr === 'GET') {
        warnings.push({
          message: 'HTTP GET with body attribute may be ignored by some browsers',
          tag: 'FETCH'
        });
      }
    }

    if (headersAttr) {
      const headersErrors = SecurityValidator.validateContent(headersAttr);
      if (headersErrors.length > 0) {
        errors.push(
          ...headersErrors.map(error => ({ ...error, tag: 'FETCH', message: `Invalid headers expression: ${headersAttr}` }))
        );
        return { code: '', errors, warnings };
      }
    }

    if (whenAttr) {
      const whenErrors = SecurityValidator.validateContent(whenAttr);
      if (whenErrors.length > 0) {
        errors.push(...whenErrors.map(error => ({ ...error, tag: 'FETCH', message: `Invalid condition: ${whenAttr}` })));
        return { code: '', errors, warnings };
      }
    }

    const intoPath = validateStatePath(intoAttr ?? '');
    if (intoAttr && !intoPath) {
      errors.push({ type: 'validation', message: `Invalid into path: ${intoAttr}`, tag: 'FETCH' });
      return { code: '', errors, warnings };
    }

    const errorPath = validateStatePath(errorAttr ?? '');
    if (errorAttr && !errorPath) {
      errors.push({ type: 'validation', message: `Invalid error path: ${errorAttr}`, tag: 'FETCH' });
      return { code: '', errors, warnings };
    }

    const loadingPath = validateStatePath(loadingAttr ?? '');
    if (loadingAttr && !loadingPath) {
      errors.push({ type: 'validation', message: `Invalid loading path: ${loadingAttr}`, tag: 'FETCH' });
      return { code: '', errors, warnings };
    }

    const dependencySet = new Set<string>();
    dependencySet.add(urlExpr);
    if (bodyAttr) dependencySet.add(bodyAttr);
    if (headersAttr) dependencySet.add(headersAttr);
    if (whenAttr) dependencySet.add(whenAttr);

    if (depsAttr) {
      for (const raw of depsAttr.split(',')) {
        const dep = raw.trim();
        if (!dep) {
          continue;
        }
        const depErrors = SecurityValidator.validateContent(dep);
        if (depErrors.length > 0) {
          errors.push(...depErrors.map(error => ({ ...error, tag: 'FETCH', message: `Invalid dependency: ${dep}` })));
          return { code: '', errors, warnings };
        }
        dependencySet.add(dep);
      }
    }

    const dependencies = Array.from(dependencySet);
    const immediate = immediateAttr ? immediateAttr.toLowerCase() !== 'false' : true;
    const once = onceAttr ? onceAttr.toLowerCase() === 'true' : false;
    const fetchId = `__fetch_${++fetchCounter}`;
    const runtime = ensureRuntime();
    const isComponent = !!options.componentContext;

    const depsCode =
      dependencies.length > 0
        ? `[${dependencies.map(dep => `function(){ return ${dep}; }`).join(', ')}]`
        : '[]';

    const requestInitEntries: string[] = [`method: '${methodAttr}'`];
    if (headersAttr) {
      requestInitEntries.push(`headers: ${headersAttr}`);
    }
    if (bodyAttr) {
      requestInitEntries.push(`body: ${bodyAttr}`);
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

    const parserLine = (() => {
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
    const assignErrorClear = errorPath ? buildAssignment(errorPath, 'null', isComponent) : '';
    const errorMessageExpr = "(error instanceof Error && error.message) ? error.message : String(error)";
    const assignError = buildAssignment(errorPath, errorMessageExpr, isComponent);
    const setLoadingTrue = buildAssignment(loadingPath, 'true', isComponent);
    const setLoadingFalse = buildAssignment(loadingPath, 'false', isComponent);

    const guardExpression = whenAttr ? `(${whenAttr})` : 'true';

    const code = `${runtime}
      (function(owner){
        var runtime = typeof window !== 'undefined' ? window.__htms : null;
        if (!runtime) { return; }
        runtime.registerEffect({
          owner: owner,
          id: '${fetchId}',
          deps: ${depsCode},
          immediate: ${immediate ? 'true' : 'false'},
          once: ${once ? 'true' : 'false'},
          run: function(){
            var shouldRun = ${guardExpression};
            if (!shouldRun) {
              return function(){};
            }
            var controller = (typeof AbortController === 'function') ? new AbortController() : null;
${setLoadingTrue ? `            ${setLoadingTrue.replace(/\n/g, '\n            ')}\n` : ''}
${assignErrorClear ? `            ${assignErrorClear.replace(/\n/g, '\n            ')}\n` : ''}
            var init = ${initLiteral};
            if (controller && typeof controller.signal !== 'undefined') {
              init.signal = controller.signal;
            }
            var execute = async function(){
              try {
                const response = await fetch(${urlExpr}, init);
                if (!response.ok) {
                  throw new Error('Request failed with status ' + response.status);
                }
                ${parserLine}
${assignData ? `                ${assignData.replace(/\n/g, '\n                ')}\n` : ''}
${assignErrorClear ? `                ${assignErrorClear.replace(/\n/g, '\n                ')}\n` : ''}
              } catch (error) {
${assignError ? `                ${assignError.replace(/\n/g, '\n                ')}\n` : ''}
                console.error('FETCH request failed:', error);
              } finally {
${setLoadingFalse ? `                ${setLoadingFalse.replace(/\n/g, '\n                ')}\n` : ''}
                if (runtime) {
                  runtime.notify();
                }
                if (owner && typeof owner.render === 'function') {
                  owner.render();
                }
              }
            };
            execute();
            return function(){
              if (controller && typeof controller.abort === 'function') {
                controller.abort();
              }
            };
          }
        });
      })(${isComponent ? 'this' : 'null'});`;

    CompilerLogger.logInfo('Generated fetch effect', {
      id: fetchId,
      method: methodAttr,
      hasBody: !!bodyAttr,
      parse: parseAttr
    });

    return {
      code,
      errors,
      warnings
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'FETCH' }],
      warnings
    };
  }
};
