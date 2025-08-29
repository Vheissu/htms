import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

let appendCounter = 0;

export const handleAppendTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    if (!target) {
      errors.push({ type: 'validation', message: 'APPEND requires target', tag: 'APPEND' });
      return { code: '', errors, warnings };
    }
    if (!/^[a-zA-Z0-9\-_#.\[\]=":() ]+$/.test(target)) {
      errors.push({ type: 'validation', message: 'Invalid CSS selector', tag: 'APPEND' });
      return { code: '', errors, warnings };
    }

    const sel = SecurityValidator.escapeForTemplate(target);
    const varName = `__appendTarget${++appendCounter}`;
    let code = `const ${varName} = document.querySelector(\`${sel}\`);\n`;
    code += `if (!${varName}) { console.warn('APPEND target not found: ${sel}'); } else {\n`;

    for (const child of Array.from(element.children)) {
      const { handleElement } = require('../handlers');
      const childResult = handleElement(child, { ...options, appendTargetVar: varName });
      if (childResult.errors.length > 0) {
        errors.push(...childResult.errors);
        // continue in non-strict mode
      }
      if (childResult.warnings.length > 0) warnings.push(...childResult.warnings);
      if (childResult.code) code += childResult.code + '\n';
    }

    code += `}\n`;

    CompilerLogger.logDebug('Generated append', { target: sel });
    return { code, errors, warnings };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'APPEND' }], warnings };
  }
};

