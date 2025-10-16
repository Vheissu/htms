import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { AppendDirective, DirectiveNode, TemplateNode } from '../component/ir';
import { elementToTemplateNode, isLowerCaseTag } from '../component/template-utils';
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
    const legacyVarName = `__appendTarget${++appendCounter}`;
    const isComponentContext = options.parentContext === 'component';
    let code = '';
    if (!isComponentContext) {
      code = `const ${legacyVarName} = document.querySelector(\`${sel}\`);\n`;
      code += `if (!${legacyVarName}) { console.warn('APPEND target not found: ${sel}'); } else {\n`;
    }

    const componentTemplates: TemplateNode[] = [];
    const componentDirectives: DirectiveNode[] = [];

    for (const child of Array.from(element.children)) {
      if (isComponentContext && isLowerCaseTag(child)) {
        componentTemplates.push(elementToTemplateNode(child));
        continue;
      }

      const { handleElement } = require('../handlers');
      const childResult = handleElement(child, {
        ...options,
        appendTargetVar: isComponentContext ? options.appendTargetVar : legacyVarName
      });
      if (childResult.errors.length > 0) {
        errors.push(...childResult.errors);
      }
      if (childResult.warnings.length > 0) warnings.push(...childResult.warnings);
      if (!isComponentContext && childResult.code) {
        code += childResult.code + '\n';
      }

      if (childResult.component?.template) {
        componentTemplates.push(...childResult.component.template);
      }

      if (childResult.component?.directives) {
        componentDirectives.push(...childResult.component.directives);
      } else if (childResult.code && !isComponentContext) {
        componentDirectives.push({ kind: 'statement', code: childResult.code });
      }
    }

    if (!isComponentContext) {
      code += `}\n`;
    }

    CompilerLogger.logDebug('Generated append', { target: sel });
    const directive: AppendDirective = {
      kind: 'append',
      selector: target,
      template: componentTemplates,
      directives: componentDirectives.length > 0 ? componentDirectives : undefined
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [directive]
      }
    };
  } catch (error) {
    return { code: '', errors: [{ type: 'runtime', message: String(error), tag: 'APPEND' }], warnings };
  }
};
