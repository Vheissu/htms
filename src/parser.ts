import { JSDOM } from 'jsdom';
import { handleElement } from './handlers';
import * as escodegen from 'escodegen';
import * as esprima from 'esprima';
import { ParseOptions, CompilerResult, CompilerError, CompilerWarning } from './types';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';

export function getTopLevelElements(htmlContent: string): HTMLCollection {
  try {
    const dom = new JSDOM(htmlContent);
    const elements = dom.window.document.body.children;
    
    if (elements.length === 0) {
      throw new Error('No elements found in HTML body');
    }
    
    return elements;
  } catch (error) {
    throw new Error(`Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function elementsToJsSnippets(
  elements: HTMLCollection, 
  options: ParseOptions = {}
): { code: string; errors: CompilerError[]; warnings: CompilerWarning[] } {
  let code = '';
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];
  
  try {
    for (const element of Array.from(elements)) {
      // Skip standalone ELSE nodes; IF handler consumes its immediate sibling
      if (element.tagName && element.tagName.toUpperCase() === 'ELSE') {
        warnings.push({ message: 'Top-level ELSE ignored (paired with preceding IF)', tag: 'ELSE' });
        continue;
      }
      const result = handleElement(element, {
        strictMode: options.strictMode || false,
        parentContext: 'root'
      });
      
      if (result.errors.length > 0) {
        errors.push(...result.errors);
        if (options.strictMode) {
          CompilerLogger.logValidationError('Element processing failed in strict mode', {
            tagName: element.tagName,
            errors: result.errors
          });
          continue; // Skip this element in strict mode
        }
      }
      
      if (result.warnings.length > 0) {
        warnings.push(...result.warnings);
      }
      
      if (result.code) {
        code += result.code + '\n';
      }
    }
    
    return { code, errors, warnings };
  } catch (error) {
    errors.push({
      type: 'runtime',
      message: `Element processing failed: ${error instanceof Error ? error.message : String(error)}`
    });
    return { code, errors, warnings };
  }
}

export function generateFinalJsCode(
  jsSnippets: string, 
  options: ParseOptions = {}
): { code: string; errors: CompilerError[]; warnings: CompilerWarning[] } {
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];
  
  if (!jsSnippets.trim()) {
    errors.push({
      type: 'syntax',
      message: 'No valid JavaScript code generated from input'
    });
    return { code: '', errors, warnings };
  }

  try {
    // Validate generated JavaScript syntax
    let ast = esprima.parseScript(jsSnippets, { 
      range: true, 
      tokens: true, 
      comment: true,
      tolerant: !options.strictMode // Allow some syntax errors in non-strict mode
    });

    // Security check on generated AST
    const securityErrors = validateASTSecurity(ast);
    if (securityErrors.length > 0) {
      errors.push(...securityErrors);
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    // Attach comments and generate code
    ast = escodegen.attachComments(ast, ast.comments, ast.tokens);
    
    const generatedCode = escodegen.generate(ast, {
      comment: true,
      format: {
        preserveBlankLines: true,
        indent: {
          style: '  '
        }
      }
    });

    // Wrap in appropriate module format
    const finalCode = wrapInModuleFormat(generatedCode, options.outputFormat || 'esm');
    
    return { code: finalCode, errors, warnings };
  } catch (error) {
    const syntaxError: CompilerError = {
      type: 'syntax',
      message: `JavaScript generation failed: ${error instanceof Error ? error.message : String(error)}`
    };
    
    if (error instanceof Error && 'lineNumber' in error) {
      syntaxError.line = (error as any).lineNumber;
    }
    
    errors.push(syntaxError);
    return { code: '', errors, warnings };
  }
}

function validateASTSecurity(ast: any): CompilerError[] {
  const errors: CompilerError[] = [];
  
  // Simple AST traversal to check for dangerous patterns
  function traverse(node: any): void {
    if (!node || typeof node !== 'object') return;
    
    // Check for eval calls
    if (node.type === 'CallExpression' && 
        node.callee && 
        node.callee.name === 'eval') {
      errors.push({
        type: 'security',
        message: 'eval() calls are not allowed for security reasons'
      });
    }
    
    // Check for Function constructor calls
    if (node.type === 'NewExpression' && 
        node.callee && 
        node.callee.name === 'Function') {
      errors.push({
        type: 'security',
        message: 'Function constructor calls are not allowed for security reasons'
      });
    }
    
    // Recursively traverse child nodes
    for (const key in node) {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          node[key].forEach(traverse);
        } else {
          traverse(node[key]);
        }
      }
    }
  }
  
  traverse(ast);
  return errors;
}

function wrapInModuleFormat(code: string, format: string): string {
  switch (format) {
    case 'esm':
      return `// Generated by HTMS - ESM format\n'use strict';\n\n${code}`;
    case 'cjs':
      return `// Generated by HTMS - CommonJS format\n'use strict';\n\n${code}`;
    case 'iife':
      return `// Generated by HTMS - IIFE format\n(function() {\n'use strict';\n\n${code}\n})();`;
    default:
      return `// Generated by HTMS\n'use strict';\n\n${code}`;
  }
}

export function parseHTML(htmlContent: string, options: ParseOptions = {}): CompilerResult {
  const startTime = Date.now();
  
  try {
    CompilerLogger.logInfo('Starting HTML parsing', { 
      contentLength: htmlContent.length,
      options 
    });

    // Pre-validation
    if (!htmlContent || typeof htmlContent !== 'string') {
      return {
        success: false,
        errors: [{
          type: 'validation',
          message: 'HTML content cannot be empty or invalid'
        }],
        warnings: []
      };
    }

    // Security validation of input
    const securityErrors = SecurityValidator.validateContent(htmlContent);
    if (securityErrors.length > 0) {
      CompilerLogger.logSecurityIssue('Security validation failed', { 
        errors: securityErrors 
      });
      return {
        success: false,
        errors: securityErrors,
        warnings: []
      };
    }

    // Parse HTML elements
    const elements = getTopLevelElements(htmlContent);
    
    // Convert elements to JavaScript
    const jsResult = elementsToJsSnippets(elements, options);
    
    // Generate final code
    const codeResult = generateFinalJsCode(jsResult.code, options);
    
    // Combine all errors and warnings
    const allErrors = [...jsResult.errors, ...codeResult.errors];
    const allWarnings = [...jsResult.warnings, ...codeResult.warnings];
    
    const duration = Date.now() - startTime;
    CompilerLogger.logPerformanceMetric('parseHTML', duration, {
      contentLength: htmlContent.length,
      generatedCodeLength: codeResult.code.length,
      errorCount: allErrors.length,
      warningCount: allWarnings.length
    });

    const success = allErrors.length === 0 || (!options.strictMode && allErrors.every(e => e.type !== 'security'));
    
    if (success) {
      CompilerLogger.logInfo('HTML parsing completed successfully', {
        duration,
        codeLength: codeResult.code.length,
        warningCount: allWarnings.length
      });
    } else {
      CompilerLogger.logValidationError('HTML parsing failed', {
        duration,
        errorCount: allErrors.length
      });
    }

    return {
      success,
      code: success ? codeResult.code : undefined,
      errors: allErrors,
      warnings: allWarnings
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    const compilerError: CompilerError = {
      type: 'runtime',
      message: `Unexpected error during parsing: ${error instanceof Error ? error.message : String(error)}`
    };

    CompilerLogger.logCompilerError('Unexpected parsing error', { 
      error: compilerError.message,
      duration
    });

    return {
      success: false,
      errors: [compilerError],
      warnings: []
    };
  }
}
