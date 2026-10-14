import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handleElement } from '../handlers';
import { DirectiveNode, EventDirective } from '../component/ir';
import { withLocals } from '../component/scope';
import { SourceElement } from '../source-dom';

export const handleSubmitTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const target = element.getAttribute('target');
    const prevent =
      (element.getAttribute('prevent') || 'true').toLowerCase() !== 'false';

    if (!target) {
      errors.push({
        type: 'validation',
        message: 'SUBMIT requires target',
        tag: 'SUBMIT',
      });
      return { code: '', errors, warnings };
    }

    if (!SecurityValidator.isAllowedSelector(target)) {
      errors.push({
        type: 'validation',
        message: 'Invalid CSS selector format for target',
        tag: 'SUBMIT',
      });
      return { code: '', errors, warnings };
    }

    // Build body from child tags
    let bodyCode = '';
    const isComponentContext =
      options.parentContext === 'component' || options.componentContext;
    const nestedDirectives: DirectiveNode[] = [];
    const childOptions = isComponentContext
      ? withLocals(options, 'event')
      : options;
    for (const child of Array.from(element.children)) {
      const r = handleElement(child, childOptions);
      if (r.errors.length > 0) {
        errors.push(...r.errors.map((error) => ({ ...error, tag: 'SUBMIT' })));
        if (options.strictMode) return { code: '', errors, warnings };
      }
      if (r.warnings.length > 0) warnings.push(...r.warnings);
      if (r.component?.directives) {
        nestedDirectives.push(...r.component.directives);
      } else if (isComponentContext && r.code) {
        nestedDirectives.push({ kind: 'statement', code: r.code });
      }
      if (!isComponentContext && r.code) {
        bodyCode += r.code + '\n';
      }
    }

    if (isComponentContext) {
      // Components listen inside their own render root, like <event>.
      const directive: EventDirective = {
        kind: 'event',
        selector: target,
        eventType: 'submit',
        body: bodyCode
          .split('\n')
          .map((line) => line.replace(/\s+$/, ''))
          .filter((line) => line.trim().length > 0),
        directives: nestedDirectives.length > 0 ? nestedDirectives : undefined,
        modifiers: prevent ? { prevent: true } : undefined,
      };
      return {
        code: '',
        errors,
        warnings,
        component: { directives: [directive] },
      };
    }

    const sel = SecurityValidator.jsStringLiteral(target);
    const code = `
      try {
        const forms = document.querySelectorAll(${sel});
        if (forms.length === 0) {
          console.warn('No elements found for submit target: ${sel}');
        }
        forms.forEach(function(element){
          element.addEventListener('submit', function(event){
            try {
              ${prevent ? 'event.preventDefault && event.preventDefault();' : ''}
${bodyCode
  .split('\n')
  .filter(Boolean)
  .map((l: string) => '              ' + l)
  .join('\n')}
            } catch (error) {
              console.error('Submit handler error:', error);
            }
          });
        });
      } catch (error) {
        console.error('Submit setup failed:', error);
      }`;

    CompilerLogger.logDebug('Generated submit handler', {
      target: sel,
      prevent,
    });
    return { code, errors, warnings };
  } catch (error) {
    return {
      code: '',
      errors: [{ type: 'runtime', message: String(error), tag: 'SUBMIT' }],
      warnings,
    };
  }
};
