import { JSDOM } from 'jsdom';
import { handleElement } from './handlers';
import * as escodegen from 'escodegen';
import * as acorn from 'acorn';
import {
  ParseOptions,
  CompilerResult,
  CompilerError,
  CompilerWarning,
} from './types';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';
import { compileComponents } from './component/compiler';

type ConsumableElement = Element & { __htmsConsumed?: boolean };

export function getTopLevelElements(htmlContent: string): HTMLCollection {
  try {
    const dom = new JSDOM(htmlContent);
    const elements = dom.window.document.body.children;

    if (elements.length === 0) {
      throw new Error('No elements found in HTML body');
    }

    return elements;
  } catch (error) {
    const parseError = new Error(
      `Failed to parse HTML: ${error instanceof Error ? error.message : String(error)}`
    ) as Error & { cause?: unknown };
    parseError.cause = error;
    throw parseError;
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
      if ((element as ConsumableElement).__htmsConsumed) {
        continue;
      }
      // Skip standalone ELSE nodes; IF handler consumes its immediate sibling
      if (element.tagName) {
        const tagName = element.tagName.toUpperCase();
        if (
          tagName === 'ELSE' ||
          tagName === 'ELSEIF' ||
          tagName === 'ELSE-IF'
        ) {
          warnings.push({
            message:
              'Top-level conditional branch ignored (paired with preceding IF)',
            tag: tagName,
          });
          continue;
        }
      }
      const result = handleElement(element, {
        strictMode: options.strictMode || false,
        parentContext: 'root',
      });

      if (result.errors.length > 0) {
        errors.push(...result.errors);
        if (options.strictMode) {
          CompilerLogger.logValidationError(
            'Element processing failed in strict mode',
            {
              tagName: element.tagName,
              errors: result.errors,
            }
          );
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
      message: `Element processing failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code, errors, warnings };
  }
}

interface FormattedChunk {
  code: string;
  errors: CompilerError[];
}

// Parses one chunk of generated JavaScript, checks it for dangerous calls
// and prints it back formatted. Throws acorn's SyntaxError on invalid code.
function formatChunk(
  source: string,
  sourceType: 'module' | 'script'
): FormattedChunk {
  // Validate generated JavaScript syntax. Acorn parses modern syntax
  // (optional chaining, nullish coalescing, etc.) that esprima could not.
  // Ranges are all escodegen needs to place comments; line/column
  // locations would only add an object per node.
  const comments: acorn.Comment[] = [];
  const tokens: acorn.Token[] = [];
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType,
    ranges: true,
    onComment: comments,
    onToken: tokens,
  }) as acorn.Program & { comments?: unknown[]; tokens?: unknown[] };

  const errors = validateASTSecurity(ast);

  // Attach comments in the esprima-compatible shape escodegen expects
  const esprimaComments = comments.map((comment) => ({
    type: comment.type === 'Line' ? 'Line' : 'Block',
    value: comment.value,
    range: comment.range,
  }));
  const esprimaTokens = tokens.map((token) => ({
    type: 'Punctuator',
    value: source.slice(token.start, token.end),
    range: token.range,
  }));
  ast.comments = esprimaComments;
  ast.tokens = esprimaTokens;
  const astWithComments = escodegen.attachComments(
    ast,
    esprimaComments,
    esprimaTokens
  );

  const code = escodegen.generate(astWithComments, {
    comment: true,
    format: {
      preserveBlankLines: true,
      indent: {
        style: '  ',
      },
    },
  });
  return { code, errors };
}

// The runtime preludes are the same text in every compile, so their parse,
// security check and formatting are done once per process.
const formattedPreludes = new Map<string, FormattedChunk>();

function formatPrelude(
  source: string,
  sourceType: 'module' | 'script'
): FormattedChunk {
  const key = `${sourceType}\n${source}`;
  let chunk = formattedPreludes.get(key);
  if (!chunk) {
    chunk = formatChunk(source, sourceType);
    formattedPreludes.set(key, chunk);
  }
  return chunk;
}

export function generateFinalJsCode(
  jsSnippets: string,
  options: ParseOptions = {},
  preludes: readonly string[] = []
): { code: string; errors: CompilerError[]; warnings: CompilerWarning[] } {
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];

  if (!jsSnippets.trim() && preludes.length === 0) {
    errors.push({
      type: 'syntax',
      message: 'No valid JavaScript code generated from input',
    });
    return { code: '', errors, warnings };
  }

  try {
    const sourceType =
      options.outputFormat === undefined || options.outputFormat === 'esm'
        ? 'module'
        : 'script';
    const chunks = preludes.map((prelude) =>
      formatPrelude(prelude, sourceType)
    );
    if (jsSnippets.trim()) {
      chunks.push(formatChunk(jsSnippets, sourceType));
    }

    // Security check on generated AST
    const securityErrors = chunks.flatMap((chunk) => chunk.errors);
    if (securityErrors.length > 0) {
      errors.push(...securityErrors);
      if (options.strictMode) {
        return { code: '', errors, warnings };
      }
    }

    const generatedCode = chunks.map((chunk) => chunk.code).join('\n');

    // Wrap in appropriate module format
    const finalCode = wrapInModuleFormat(
      generatedCode,
      options.outputFormat || 'esm'
    );

    return { code: finalCode, errors, warnings };
  } catch (error) {
    const syntaxError: CompilerError = {
      type: 'syntax',
      message: `JavaScript generation failed: ${error instanceof Error ? error.message : String(error)}`,
    };

    if (
      error instanceof Error &&
      'loc' in error &&
      error.loc &&
      typeof (error.loc as { line?: unknown }).line === 'number'
    ) {
      syntaxError.line = (error.loc as { line: number }).line;
      syntaxError.source = 'generated';
    }

    errors.push(syntaxError);
    return { code: '', errors, warnings };
  }
}

function validateASTSecurity(ast: unknown): CompilerError[] {
  const errors: CompilerError[] = [];

  // Walks every AST node, visiting only child nodes and node arrays.
  function traverse(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) traverse(item);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const node = value as {
      type?: string;
      callee?: { name?: string };
    };

    // Check for eval calls
    if (
      node.type === 'CallExpression' &&
      node.callee &&
      node.callee.name === 'eval'
    ) {
      errors.push({
        type: 'security',
        message: 'eval() calls are not allowed for security reasons',
      });
    }

    // setTimeout('code') / setInterval('code') evaluate their argument.
    if (
      node.type === 'CallExpression' &&
      isTimerCallee((node as { callee?: unknown }).callee)
    ) {
      const [firstArgument] =
        (node as { arguments?: Array<{ type?: string; value?: unknown }> })
          .arguments ?? [];
      if (
        firstArgument &&
        ((firstArgument.type === 'Literal' &&
          typeof firstArgument.value === 'string') ||
          firstArgument.type === 'TemplateLiteral' ||
          firstArgument.type === 'BinaryExpression')
      ) {
        errors.push({
          type: 'security',
          message:
            'setTimeout/setInterval with a string argument is not allowed; pass a function',
        });
      }
    }

    // Check for Function constructor calls
    if (
      node.type === 'NewExpression' &&
      node.callee &&
      node.callee.name === 'Function'
    ) {
      errors.push({
        type: 'security',
        message:
          'Function constructor calls are not allowed for security reasons',
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        child !== null &&
        typeof child === 'object' &&
        !NON_CHILD_KEYS.has(key)
      )
        traverse(child);
    }
  }

  traverse(ast);
  return errors;
}

// AST properties that never hold child nodes.
const NON_CHILD_KEYS = new Set([
  'type',
  'start',
  'end',
  'range',
  'loc',
  'raw',
  'value',
  'name',
  'operator',
  'kind',
  'regex',
  'bigint',
  'sourceType',
]);

const TIMER_FUNCTIONS = new Set(['setTimeout', 'setInterval']);

function isTimerCallee(callee: unknown): boolean {
  if (!callee || typeof callee !== 'object') return false;
  const node = callee as {
    type?: string;
    name?: string;
    computed?: boolean;
    property?: { type?: string; name?: string };
  };
  if (node.type === 'Identifier') {
    return TIMER_FUNCTIONS.has(node.name ?? '');
  }
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property?.type === 'Identifier' &&
    TIMER_FUNCTIONS.has(node.property.name ?? '')
  );
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

export function parseHTML(
  htmlContent: string,
  options: ParseOptions = {}
): CompilerResult {
  const startTime = Date.now();
  const preflightWarnings: CompilerWarning[] = [];

  const mode = options.mode ?? 'component';
  const parseOptions: ParseOptions = { ...options, mode };

  if (mode !== 'component') {
    return {
      success: false,
      code: undefined,
      errors: [
        {
          type: 'validation',
          message:
            'Legacy DOM compilation is no longer supported. Wrap markup in a <component> root.',
        },
      ],
      warnings: [],
    };
  }

  try {
    CompilerLogger.logInfo('Starting HTML parsing', {
      contentLength: htmlContent.length,
      options: parseOptions,
    });

    if (!htmlContent || typeof htmlContent !== 'string') {
      return {
        success: false,
        errors: [
          {
            type: 'validation',
            message: 'HTML content cannot be empty or invalid',
          },
        ],
        warnings: [],
      };
    }

    const securityErrors = SecurityValidator.validateContent(htmlContent);
    if (securityErrors.length > 0) {
      CompilerLogger.logSecurityIssue('Security validation failed', {
        errors: securityErrors,
      });
      if (parseOptions.strictMode) {
        return {
          success: false,
          errors: securityErrors,
          warnings: [],
        };
      }
      preflightWarnings.push(
        ...securityErrors.map((error) => ({ message: error.message }))
      );
    }

    const componentResult = compileComponents(htmlContent, parseOptions);
    const codeResult = componentResult.code
      ? generateFinalJsCode(
          componentResult.body ?? componentResult.code,
          parseOptions,
          componentResult.body === undefined ? [] : componentResult.preludes
        )
      : { code: '', errors: [], warnings: [] };

    const allErrors = [...componentResult.errors, ...codeResult.errors];
    const allWarnings = [
      ...preflightWarnings,
      ...componentResult.warnings,
      ...codeResult.warnings,
    ];

    const duration = Date.now() - startTime;
    CompilerLogger.logPerformanceMetric('parseHTML(component)', duration, {
      contentLength: htmlContent.length,
      generatedCodeLength: codeResult.code.length,
      errorCount: allErrors.length,
      warningCount: allWarnings.length,
    });

    const success = allErrors.length === 0;

    if (!success) {
      return {
        success,
        errors: allErrors,
        warnings: allWarnings,
      } as CompilerResult;
    }

    return {
      success: true,
      code: codeResult.code,
      errors: allErrors,
      warnings: allWarnings,
      components: componentResult.components,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const compilerError: CompilerError = {
      type: 'runtime',
      message: `Unexpected error during parsing: ${error instanceof Error ? error.message : String(error)}`,
    };

    CompilerLogger.logCompilerError('Unexpected parsing error', {
      error: compilerError.message,
      duration,
    });

    return { success: false, errors: [compilerError], warnings: [] };
  }
}
