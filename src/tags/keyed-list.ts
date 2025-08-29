import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

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

    const runtime = `
      (function(){
        if (typeof window === 'undefined') return;
        if (!window.__htms) { window.__htms = { watchers: [], bind: function(){}, notify: function(){ this.watchers.forEach(function(w){ try{ const el=document.querySelector(w.sel); if(el) el[w.prop]=w.fn(); } catch(e){} }); } }; }
        if (!window.__htms.keyedList) {
          window.__htms.keyedList = function(sel, arr, render, keyFn){
            const container = document.querySelector(sel);
            if (!container) { console.warn('KEYEDLIST target not found:', sel); return; }
            const existing = new Map();
            Array.from(container.children).forEach(function(node){ const k = node.getAttribute && node.getAttribute('data-key'); if (k!=null) existing.set(k, node); });
            const used = new Set();
            for (let i=0;i<arr.length;i++){
              const item = arr[i];
              const key = String(keyFn(item, i));
              let node = existing.get(key);
              if (!node) { node = render(item, i); if (node && node.setAttribute) node.setAttribute('data-key', key); }
              if (node) { container.appendChild(node); used.add(key); }
            }
            existing.forEach(function(node, key){ if (!used.has(key)) { if (node && node.parentNode===container) container.removeChild(node); } });
          };
        }
      })();`;

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
