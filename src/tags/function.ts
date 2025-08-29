import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

export const handleFunctionTag: TagHandler = (
  element: Element, 
  options: TagHandlerOptions = {}
): HandlerResult => {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  
  try {
    const name = element.getAttribute('name');
    const params = element.getAttribute('params') || '';
    const body = element.children.length === 0 ? (element.textContent?.trim() || '') : '';

    if (!name) {
      errors.push({
        type: 'validation',
        message: 'FUNCTION tag requires a name attribute',
        tag: 'FUNCTION'
      });
      return { code: '', errors, warnings };
    }

    // Validate function name
    const nameErrors = SecurityValidator.validateJavaScriptIdentifier(name);
    if (nameErrors.length > 0) {
      errors.push(...nameErrors.map(error => ({ ...error, tag: 'FUNCTION' })));
      return { code: '', errors, warnings };
    }

    // Validate parameters
    const paramList: string[] = [];
    if (params.trim()) {
      const paramNames = params.split(',').map(p => p.trim());
      
      for (const param of paramNames) {
        const paramErrors = SecurityValidator.validateJavaScriptIdentifier(param);
        if (paramErrors.length > 0) {
          errors.push(...paramErrors.map(error => ({ 
            ...error, 
            tag: 'FUNCTION',
            message: `Invalid parameter name: ${param}` 
          })));
          return { code: '', errors, warnings };
        }
        paramList.push(param);
      }
    }

    // Security validation of function body
    if (body) {
      const bodyErrors = SecurityValidator.validateContent(body);
      if (bodyErrors.length > 0) {
        errors.push(...bodyErrors.map(error => ({ ...error, tag: 'FUNCTION' })));
        if (options.strictMode) {
          return { code: '', errors, warnings };
        }
      }

      // Additional validation for function bodies
      if (/\breturn\s+eval\s*\(|\breturn\s+Function\s*\(/.test(body)) {
        errors.push({
          type: 'security',
          message: 'Function body cannot return eval() or Function() calls',
          tag: 'FUNCTION'
        });
        return { code: '', errors, warnings };
      }
    }

    // Generate function with safe body (do not sanitize JS code; rely on validation above)
    const paramString = paramList.join(', ');

    // Build body from raw text (if any) and child tags
    let innerCode = '';
    if (body) innerCode += body + '\n';
    for (const child of Array.from(element.children)) {
      const { handleElement } = require('../handlers');
      const childResult = handleElement(child, options);
      if (childResult.errors.length > 0) {
        errors.push(...childResult.errors.map((e: any) => ({ ...e, tag: 'FUNCTION' })));
        if (options.strictMode) continue;
      }
      if (childResult.warnings.length > 0) warnings.push(...childResult.warnings);
      if (childResult.code) innerCode += childResult.code + '\n';
    }

    // Wrap function body in try-catch for safety
    const safeBody = innerCode.trim() ? `
      try {
${innerCode.split('\n').filter(Boolean).map(l => '        ' + l).join('\n')}
      } catch (error) {
        console.error('Function ${name} execution error:', error);
      }
    ` : `
      // Empty function body
    `;

    const code = `function ${name}(${paramString}) {${safeBody}}`;

    if (body && (body.includes('eval') || body.includes('Function('))) {
      warnings.push({
        message: 'Function body contains potentially dangerous constructs',
        tag: 'FUNCTION'
      });
      
      CompilerLogger.logSecurityIssue('Function with dangerous constructs', {
        functionName: name,
        body: innerCode
      });
    }

    CompilerLogger.logDebug('Generated function declaration', {
      name,
      parameterCount: paramList.length,
      hasBody: innerCode.trim().length > 0,
      bodyLength: innerCode.length,
      wasSanitized: false
    });

    return { code, errors, warnings };

  } catch (error) {
    const runtimeError = {
      type: 'runtime' as const,
      message: `Function tag handler failed: ${error instanceof Error ? error.message : String(error)}`,
      tag: 'FUNCTION'
    };
    
    CompilerLogger.logCompilerError('Function tag handler error', {
      error: runtimeError.message,
      element: element.outerHTML
    });
    
    return { code: '', errors: [runtimeError], warnings };
  }
};
