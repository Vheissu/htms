import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';

let effectCounter = 0;

function splitStatements(source: string): string[] {
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function ensureTerminated(statement: string): string {
  const trimmed = statement.trim();
  if (trimmed.endsWith(';') || trimmed.endsWith('}') || trimmed.endsWith(')')) {
    return trimmed;
  }
  return `${trimmed};`;
}

export const handleEffectTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const runAttr = element.getAttribute('run')?.trim() ?? '';
    const cleanupAttr = element.getAttribute('cleanup')?.trim() ?? '';
    const depsAttr = element.getAttribute('deps');
    const immediateAttr = element.getAttribute('immediate');
    const onceAttr = element.getAttribute('once');

    const bodyStatements: string[] = [];

    const collectCode = (code: string) => {
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
          errors.push(...textErrors.map(error => ({ ...error, tag: 'EFFECT' })));
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
        }
        collectCode(text);
      } else if (node.nodeType === 1) {
        const child = node as Element;
        const { handleElement } = require('../handlers');
        const childOptions: TagHandlerOptions = {
          ...options,
          parentContext: 'effect'
        };
        const childResult: HandlerResult = handleElement(child, childOptions);
        if (childResult.errors.length > 0) {
          errors.push(...childResult.errors.map(error => ({ ...error, tag: 'EFFECT' })));
          if (options.strictMode) {
            return { code: '', errors, warnings };
          }
        }
        if (childResult.warnings.length > 0) {
          warnings.push(...childResult.warnings.map(warning => ({ ...warning, tag: warning.tag ?? 'EFFECT' })));
        }
        if (childResult.code) {
          collectCode(childResult.code);
        }
      }
    }

    if (runAttr) {
      const runErrors = SecurityValidator.validateContent(runAttr);
      if (runErrors.length > 0) {
        errors.push(...runErrors.map(error => ({ ...error, tag: 'EFFECT' })));
        return { code: '', errors, warnings };
      }
      collectCode(ensureTerminated(runAttr));
    }

    if (bodyStatements.length === 0) {
      errors.push({
        type: 'validation',
        message: 'EFFECT requires body content via run attribute, text, or child tags',
        tag: 'EFFECT'
      });
      return { code: '', errors, warnings };
    }

    if (cleanupAttr) {
      const cleanupErrors = SecurityValidator.validateContent(cleanupAttr);
      if (cleanupErrors.length > 0) {
        errors.push(...cleanupErrors.map(error => ({ ...error, tag: 'EFFECT' })));
        return { code: '', errors, warnings };
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
          errors.push(...depErrors.map(error => ({ ...error, tag: 'EFFECT', message: `Invalid dependency expression: ${dep}` })));
          return { code: '', errors, warnings };
        }
        dependencies.push(dep);
      }
    }

    const immediate = immediateAttr ? immediateAttr.toLowerCase() !== 'false' : true;
    const once = onceAttr ? onceAttr.toLowerCase() === 'true' : false;
    const effectId = `__effect_${++effectCounter}`;
    const runtime = ensureRuntime();
    const ownerExpr = options.componentContext ? 'this' : 'null';

    const depsCode =
      dependencies.length > 0
        ? `[${dependencies.map(dep => `function(){ return ${dep}; }`).join(', ')}]`
        : '[]';

    const runBody = bodyStatements
      .map(line => `            ${line}`)
      .join('\n');

    const cleanupBlock = cleanupAttr
      ? `
          cleanup: function(){
            try {
              ${cleanupAttr}
            } catch (error) {
              console.error('EFFECT cleanup failed:', error);
            }
          },`
      : '';

    const code = `${runtime}
      (function(owner){
        var runtime = typeof window !== 'undefined' ? window.__htms : null;
        if (!runtime) { return; }
        runtime.registerEffect({
          owner: owner,
          id: '${effectId}',
          deps: ${depsCode},
          immediate: ${immediate ? 'true' : 'false'},
          once: ${once ? 'true' : 'false'},
          run: function(){
            try {
${runBody}
            } catch (error) {
              console.error('EFFECT run failed:', error);
            }
          },${cleanupBlock ? `\n${cleanupBlock.slice(1)}` : '\n'}
        });
      })(${ownerExpr});`;

    CompilerLogger.logDebug('Generated effect', {
      id: effectId,
      dependencies: dependencies.length,
      immediate,
      once
    });

    return {
      code,
      errors,
      warnings
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'EFFECT' }],
      warnings
    };
  }
};
