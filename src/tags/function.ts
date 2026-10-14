import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { handleElement } from '../handlers';
import { DirectiveNode, MethodDirective } from '../component/ir';
import { handlerScope, withLocals } from '../component/scope';
import { SourceElement } from '../source-dom';

// Inside a component, <function name="save" params="item"> becomes a class
// method. Text is the method body; child tags (<set>, <push>, ...) run in
// document order with it. Bare field names resolve to `this.<field>`.
function buildComponentMethod(
  element: SourceElement,
  name: string,
  params: string[],
  options: TagHandlerOptions,
  diagnostics: Pick<HandlerResult, 'errors' | 'warnings'>
): HandlerResult {
  const { errors, warnings } = diagnostics;
  const scope = handlerScope(options);
  const childOptions = withLocals(options, ...params);
  const body: DirectiveNode[] = [];
  let pendingText = '';
  const flushText = (): void => {
    if (pendingText.trim()) {
      body.push({
        kind: 'statement',
        code: scope.statements(pendingText.trim(), params),
      });
    }
    pendingText = '';
  };

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) {
      pendingText += node.textContent ?? '';
      continue;
    }
    if (node.nodeType !== 1) {
      continue;
    }
    flushText();
    const result = handleElement(node as SourceElement, childOptions);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.component?.directives) {
      body.push(...result.component.directives);
    } else if (result.code) {
      body.push({ kind: 'statement', code: result.code });
    }
  }
  flushText();

  const asyncAttr = element.getAttribute('async');
  const method: MethodDirective = {
    kind: 'method',
    name,
    params,
    async: asyncAttr !== null && asyncAttr.toLowerCase() !== 'false',
    body,
  };
  return { code: '', errors, warnings, component: { directives: [method] } };
}

export const handleFunctionTag: TagHandler = (
  element: SourceElement,
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];

  try {
    const name = element.getAttribute('name');
    const params = element.getAttribute('params') || '';
    const body =
      element.children.length === 0 ? element.textContent?.trim() || '' : '';

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'FUNCTION tag requires a name attribute',
        tag: 'FUNCTION',
      });
      return { code: '', errors, warnings };
    }

    // Validate function name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      errors.push(
        ...nameErrors.map((error) => ({ ...error, tag: 'FUNCTION' }))
      );
      return { code: '', errors, warnings };
    }

    // Validate parameters
    const paramList: string[] = [];
    if (params.trim()) {
      const paramNames = params.split(',').map((p) => p.trim());

      for (const param of paramNames) {
        const paramErrors =
          SecurityValidator.validateJavaScriptIdentifier(param);
        if (paramErrors.length > 0) {
          errors.push(
            ...paramErrors.map((error) => ({
              ...error,
              tag: 'FUNCTION',
              message: `Invalid parameter name: ${param}`,
            }))
          );
          return { code: '', errors, warnings };
        }
        paramList.push(param);
      }
    }

    // Security validation of function body
    if (body) {
      const bodyErrors = SecurityValidator.validateContent(body);
      if (bodyErrors.length > 0) {
        errors.push(
          ...bodyErrors.map((error) => ({ ...error, tag: 'FUNCTION' }))
        );
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }

      // Additional validation for function bodies
      if (/\breturn\s+eval\s*\(|\breturn\s+Function\s*\(/.test(body)) {
        errors.push({
          type: 'security',
          message: 'Function body cannot return eval() or Function() calls',
          tag: 'FUNCTION',
        });
        return { code: '', errors, warnings };
      }
    }

    if (options.componentContext) {
      return buildComponentMethod(element, name, paramList, options, {
        errors,
        warnings,
      });
    }

    // Generate function with safe body (do not sanitize JS code; rely on validation above)
    const paramString = paramList.join(', ');

    // Build body from raw text (if any) and child tags
    let innerCode = '';
    if (body) innerCode += body + '\n';
    for (const child of Array.from(element.children)) {
      const childResult = handleElement(child, options);
      if (childResult.errors.length > 0) {
        errors.push(
          ...childResult.errors.map((error) => ({
            ...error,
            tag: 'FUNCTION',
          }))
        );
        if (options.strictMode) continue;
      }
      if (childResult.warnings.length > 0)
        warnings.push(...childResult.warnings);
      if (childResult.code) innerCode += childResult.code + '\n';
    }

    // Wrap function body in try-catch for safety
    const safeBody = innerCode.trim()
      ? `
      try {
${innerCode
  .split('\n')
  .filter(Boolean)
  .map((l) => '        ' + l)
  .join('\n')}
      } catch (error) {
        console.error('Function ${name} execution error:', error);
      }
    `
      : `
      // Empty function body
    `;

    const code = `function ${name}(${paramString}) {${safeBody}}`;

    if (body && (body.includes('eval') || body.includes('Function('))) {
      warnings.push({
        message: 'Function body contains potentially dangerous constructs',
        tag: 'FUNCTION',
      });

      CompilerLogger.logSecurityIssue('Function with dangerous constructs', {
        functionName: name,
        body: innerCode,
      });
    }

    CompilerLogger.logDebug('Generated function declaration', {
      name,
      parameterCount: paramList.length,
      hasBody: innerCode.trim().length > 0,
      bodyLength: innerCode.length,
      wasSanitized: false,
    });

    return { code, errors, warnings };
  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Function tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'FUNCTION',
    };

    CompilerLogger.logCompilerError('Function tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML,
    });

    return { code: '', errors: [runtimeError], warnings };
  }
};
