import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';

let keyedCounter = 0;

export const handleKeyedListTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    const ofExpr = element.getAttribute('of');
    const itemVar = element.getAttribute('item') || 'item';
    const indexVar = element.getAttribute('index') || 'i';
    const keyExpr = element.getAttribute('key') || itemVar;

    if (!target || !ofExpr) {
      errors.push({ type: 'validation', message: 'KEYEDLIST requires target and of', tag: 'KEYEDLIST' });
      return { code: '', errors, warnings };
    }

    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(target)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector for target', tag: 'KEYEDLIST' });
      return { code: '', errors, warnings };
    }

    // Validate identifiers
    for (const v of [itemVar, indexVar]) {
      const idErr = SecurityValidator.validateJavaScriptIdentifier(v);
      if (idErr.length > 0) {
        errors.push(...idErr.map(e => ({ ...e, tag: 'KEYEDLIST' })));
        return { code: '', errors, warnings };
      }
    }

    // Validate child template: require exactly one top-level element child
    const children = Array.from(element.children);
    if (children.length !== 1) {
      errors.push({ type: 'validation', message: 'KEYEDLIST requires exactly one template element child', tag: 'KEYEDLIST' });
      return { code: '', errors, warnings };
    }

    const templateEl = children[0];
    const { handleElement } = require('../handlers');
    const tpl = handleElement(templateEl, { ...options, loopVariable: itemVar, parentContext: 'template' });
    if (tpl.errors.length > 0) {
      errors.push(...tpl.errors.map((e: any) => ({ ...e, tag: 'KEYEDLIST' })));
      if (options.strictMode) return { code: '', errors, warnings };
    }
    if (tpl.warnings.length > 0) warnings.push(...tpl.warnings);

    if (!tpl.code) {
      errors.push({ type: 'validation', message: 'Empty KEYEDLIST template', tag: 'KEYEDLIST' });
      return { code: '', errors, warnings };
    }

    // Extract top element variable name
    const m = tpl.code.match(/const (\w+) = document\.createElement/);
    if (!m) {
      errors.push({ type: 'validation', message: 'Template must create a top-level element', tag: 'KEYEDLIST' });
      return { code: '', errors, warnings };
    }
    const topVar = m[1];

    const selEsc = SecurityValidator.escapeForTemplate(target);
    const id = ++keyedCounter;

    const runtime = ensureRuntime();

    const code = `${runtime}
      (function(){
        var __render_item_${id} = function(${itemVar}, ${indexVar}){
${tpl.code.split('\n').map((l: string) => '          ' + l).join('\n')}
          return ${topVar};
        };
        var __key_${id} = function(${itemVar}, ${indexVar}){ return ${keyExpr}; };
        if (typeof window !== 'undefined' && window.__htms) {
          window.__htms.keyedList(\`${selEsc}\`, ${ofExpr}, __render_item_${id}, __key_${id});
        } else {
          // Fallback: rebuild
          var c = document.querySelector(\`${selEsc}\`);
          if (c) { c.textContent=''; for (var ${indexVar}=0; ${indexVar}<${ofExpr}.length; ${indexVar}++){ var ${itemVar}=${ofExpr}[${indexVar}]; c.appendChild(__render_item_${id}(${itemVar}, ${indexVar})); } }
        }
      })();`;

    CompilerLogger.logDebug('Generated keyed list', { target, ofExpr, itemVar, indexVar });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'KEYEDLIST' }], warnings };
  }
};
