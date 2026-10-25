import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handlerDiagnostics } from './diagnostics';
import {
  DirectiveNode,
  KeyedListDirective,
  TemplateChild,
  TemplateNode,
} from '../component/ir';
import {
  collectTemplateSecurityErrors,
  elementToTemplateNode,
  isLowerCaseTag,
  partitionTemplateErrors,
} from '../component/template-utils';
import { SecurityValidator } from '../utils/security';
import { handlerScope, withLocals } from '../component/scope';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';
import { handleElement } from '../handlers';
import { getNodeLocation } from '../diagnostics';
import { SourceElement } from '../source-dom';

let keyedCounter = 0;

// Location-based ids keep compiled output deterministic; the counter is a
// fallback for elements parsed without node locations (unit tests, DOM
// fragments created directly).
function stableId(prefix: string, element: SourceElement): string {
  const location = getNodeLocation(element);
  if (location) {
    return `${prefix}_${location.line}_${location.column}`;
  }
  return `${prefix}_${++keyedCounter}`;
}

function resolveComponentSource(source: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(source) ? `this.${source}` : source;
}

export const handleKeyedListTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const { errors, warnings, fail, failWith, empty } =
    handlerDiagnostics('KEYEDLIST');

  try {
    const target = element.getAttribute('target');
    const ofExpr = element.getAttribute('of');
    const itemVar = element.getAttribute('item') || 'item';
    const indexVar = element.getAttribute('index') || 'i';
    const keyExpr = element.getAttribute('key') || itemVar;

    if (!target || !ofExpr) {
      return fail('KEYEDLIST requires target and of');
    }

    if (!SecurityValidator.isAllowedSelector(target)) {
      return fail('Invalid CSS selector for target');
    }

    // Validate identifiers
    for (const v of [itemVar, indexVar]) {
      const idErr = SecurityValidator.validateJavaScriptIdentifier(v);
      if (idErr.length > 0) {
        return failWith(idErr);
      }
    }

    const sourceErrors = SecurityValidator.validateContent(ofExpr);
    if (sourceErrors.length > 0) {
      errors.push(
        ...sourceErrors.map((e) => ({
          ...e,
          tag: 'KEYEDLIST',
          message: `Invalid list expression: ${ofExpr}`,
        }))
      );
      return empty();
    }

    const keyErrors = SecurityValidator.validateContent(keyExpr);
    if (keyErrors.length > 0) {
      errors.push(
        ...keyErrors.map((e) => ({
          ...e,
          tag: 'KEYEDLIST',
          message: `Invalid key expression: ${keyExpr}`,
        }))
      );
      return empty();
    }

    // Validate child template: require exactly one top-level element child
    const children = Array.from(element.children);
    if (children.length !== 1) {
      return fail('KEYEDLIST requires exactly one template element child');
    }

    const templateEl = children[0];
    if (options.componentContext) {
      if (!isLowerCaseTag(templateEl)) {
        return fail(
          'KEYEDLIST component template must be a standard HTML element'
        );
      }

      const findings = partitionTemplateErrors(
        collectTemplateSecurityErrors(templateEl),
        options.strictMode ?? false
      );
      errors.push(...findings.errors);
      warnings.push(...findings.warnings);

      // Directive tags nested inside the item template (e.g. <event>)
      // resolve to template children scoped to each rendered item.
      const template: TemplateNode[] = [
        elementToTemplateNode(templateEl, (child) => {
          const childResult = handleElement(
            child,
            withLocals(
              {
                ...options,
                loopVariable: itemVar,
                parentContext: 'component',
                componentContext: true,
              },
              itemVar,
              indexVar
            )
          );
          errors.push(...childResult.errors);
          warnings.push(...childResult.warnings);

          const children: TemplateChild[] = [];
          if (childResult.component?.template) {
            children.push(...childResult.component.template);
          }
          if (childResult.component?.directives) {
            for (const directive of childResult.component.directives) {
              children.push({ type: 'directive', directive });
            }
          } else if (childResult.code) {
            children.push({
              type: 'directive',
              directive: { kind: 'statement', code: childResult.code },
            });
          }
          return children;
        }),
      ];
      const directives: DirectiveNode[] = [];

      if (errors.length > 0 && options.strictMode) {
        return empty();
      }

      const componentDirective: KeyedListDirective = {
        kind: 'keyed-list',
        selector: target,
        source: options.componentFields
          ? handlerScope(options).expression(ofExpr)
          : resolveComponentSource(ofExpr),
        itemVar,
        indexVar,
        key: handlerScope(options).expression(keyExpr, [itemVar, indexVar]),
        template,
        directives,
      };

      CompilerLogger.logDebug('Generated component keyed list', {
        target,
        ofExpr,
        itemVar,
        indexVar,
      });

      return {
        code: '',
        errors,
        warnings,
        component: {
          directives: [componentDirective],
        },
      };
    }

    const tpl = handleElement(templateEl, {
      ...options,
      loopVariable: itemVar,
      parentContext: 'template',
    });
    if (tpl.errors.length > 0) {
      errors.push(
        ...tpl.errors.map((error) => ({ ...error, tag: 'KEYEDLIST' }))
      );
      if (options.strictMode) return empty();
    }
    if (tpl.warnings.length > 0) warnings.push(...tpl.warnings);

    if (!tpl.code) {
      return fail('Empty KEYEDLIST template');
    }

    // Extract top element variable name
    const m = tpl.code.match(/const (\w+) = document\.createElement/);
    if (!m) {
      return fail('Template must create a top-level element');
    }
    const topVar = m[1];

    const selEsc = SecurityValidator.jsStringLiteral(target);
    const id = stableId('keyed', element);

    const runtime = ensureRuntime();

    const code = `${runtime}
      (function(){
        var __render_item_${id} = function(${itemVar}, ${indexVar}){
${tpl.code
  .split('\n')
  .map((l: string) => '          ' + l)
  .join('\n')}
          return ${topVar};
        };
        var __key_${id} = function(${itemVar}, ${indexVar}){ return ${keyExpr}; };
        if (typeof window !== 'undefined' && window.__htms) {
          window.__htms.keyedList(${selEsc}, ${ofExpr}, __render_item_${id}, __key_${id});
        } else {
          // Fallback: rebuild
          var c = document.querySelector(${selEsc});
          if (c) { c.textContent=''; for (var ${indexVar}=0; ${indexVar}<${ofExpr}.length; ${indexVar}++){ var ${itemVar}=${ofExpr}[${indexVar}]; c.appendChild(__render_item_${id}(${itemVar}, ${indexVar})); } }
        }
      })();`;

    CompilerLogger.logDebug('Generated keyed list', {
      target,
      ofExpr,
      itemVar,
      indexVar,
    });
    return { code, errors, warnings };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'KEYEDLIST' }],
      warnings,
    };
  }
};
