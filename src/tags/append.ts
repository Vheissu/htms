import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { AppendDirective, DirectiveNode, TemplateNode } from '../component/ir';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handleElement } from '../handlers';
import { getNodeLocation } from '../diagnostics';

let appendCounter = 0;

// Location-based ids keep compiled output deterministic; the counter is a
// fallback for elements parsed without node locations.
function stableVarName(element: Element): string {
  const location = getNodeLocation(element);
  if (location) {
    return `__appendTarget_${location.line}_${location.column}`;
  }
  return `__appendTarget${++appendCounter}`;
}

export const handleAppendTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    if (!target) {
      errors.push({
        type: 'validation',
        message: 'APPEND requires target',
        tag: 'APPEND',
      });
      return { code: '', errors, warnings };
    }
    if (!SecurityValidator.isAllowedSelector(target)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector',
        tag: 'APPEND',
      });
      return { code: '', errors, warnings };
    }

    const sel = SecurityValidator.jsStringLiteral(target);
    const legacyVarName = stableVarName(element);
    const isComponentContext =
      options.parentContext === 'component' || options.componentContext;
    let code = '';
    if (!isComponentContext) {
      code = `const ${legacyVarName} = document.querySelector(${sel});\n`;
      code += `if (!${legacyVarName}) { console.warn('APPEND target not found: ${sel}'); } else {\n`;
    }

    const componentTemplates: TemplateNode[] = [];
    const componentDirectives: DirectiveNode[] = [];

    for (const child of Array.from(element.children)) {
      const childResult = handleElement(child, {
        ...options,
        componentContext: isComponentContext || options.componentContext,
        appendTargetVar: isComponentContext
          ? options.appendTargetVar
          : legacyVarName,
      });
      if (childResult.errors.length > 0) {
        errors.push(...childResult.errors);
      }
      if (childResult.warnings.length > 0)
        warnings.push(...childResult.warnings);
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
      directives:
        componentDirectives.length > 0 ? componentDirectives : undefined,
    };

    return {
      code,
      errors,
      warnings,
      component: {
        directives: [directive],
      },
    };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'APPEND' }],
      warnings,
    };
  }
};
