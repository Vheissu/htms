import * as acorn from 'acorn';
import { CompilerError } from '../types';

// Content patterns that indicate code injection or executable markup.
// Timers are only eval-like with a string argument, and file-system paths
// are only meaningful for file arguments (see validateFilePath), so
// `setTimeout(() => ...)` and `<a href="../docs">` are not flagged.
const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
  /\bFunction\s*\(/,
  /document\.write/,
  /innerHTML\s*=/,
  /outerHTML\s*=/,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /<script/i,
  // Inline event-handler attributes (onclick=, onload=, ...). Restricted to
  // known handler names so legitimate attributes like `once` or `one` are
  // not false positives; validateHtmlAttribute rejects `on*` names anyway.
  /(?:^|[\s<])on(?:abort|auxclick|blur|cancel|click|close|contextmenu|copy|cut|dblclick|drag(?:start|end|enter|leave|over|drop)?|error|focus(?:in|out)?|input|key(?:down|press|up)|load|mouse(?:down|up|move|over|out|enter|leave|wheel)|pointer(?:down|up|move|over|out|enter|leave|cancel)|reset|resize|scroll|select|submit|touch(?:start|end|move|cancel)|wheel)\s*=/i,
];

// Known DOM event-handler content attributes (onclick, onload, ...).
// Arbitrary `on*` attribute names are inert in HTML — only these actually
// execute, and names like `once` must not false-positive.
const EVENT_HANDLER_ATTRIBUTES = new Set([
  'onabort',
  'onauxclick',
  'onbeforeinput',
  'onblur',
  'oncancel',
  'onchange',
  'onclick',
  'onclose',
  'oncontextmenu',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'onerror',
  'onfocus',
  'onfocusin',
  'onfocusout',
  'oninput',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onload',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onmousewheel',
  'onpaste',
  'onpointercancel',
  'onpointerdown',
  'onpointerenter',
  'onpointerleave',
  'onpointermove',
  'onpointerout',
  'onpointerover',
  'onpointerup',
  'onreset',
  'onresize',
  'onscroll',
  'onscrollend',
  'onselect',
  'onsubmit',
  'ontouchcancel',
  'ontouchend',
  'ontouchmove',
  'ontouchstart',
  'onwheel',
]);

// HTML entity escaping and decimal-number check, matching validator.js's
// `escape` and `isNumeric` so the package itself need not be loaded.
const HTML_ESCAPE_PATTERN = /[&"'<>/\\`]/g;
const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['"', '&quot;'],
  ["'", '&#x27;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['/', '&#x2F;'],
  ['\\', '&#x5C;'],
  ['`', '&#96;'],
]);
const NUMERIC_VALUE = /^[+-]?(?:[0-9]+|[0-9]*\.[0-9]+)$/;

const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'async',
  'await',
  'static',
  'enum',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  // Literals that are syntactically valid against the identifier pattern but
  // cannot be used as binding names (e.g. `const true = ...` is a syntax error).
  'null',
  'true',
  'false',
]);

export class SecurityValidator {
  static isNumericLiteral(value: string): boolean {
    if (!value) return false;

    let index = value.startsWith('-') ? 1 : 0;
    if (index === value.length) return false;

    let integerDigits = 0;
    while (
      index < value.length &&
      value.charCodeAt(index) >= 48 &&
      value.charCodeAt(index) <= 57
    ) {
      integerDigits += 1;
      index += 1;
    }
    if (integerDigits === 0) return false;

    if (value.charAt(index) === '.') {
      index += 1;
      let decimalDigits = 0;
      while (
        index < value.length &&
        value.charCodeAt(index) >= 48 &&
        value.charCodeAt(index) <= 57
      ) {
        decimalDigits += 1;
        index += 1;
      }
      if (decimalDigits === 0) return false;
    }

    return index === value.length;
  }

  static isJavaScriptPath(value: string): boolean {
    const parts = value.split('.');
    if (parts.length === 0) return false;

    return parts.every(
      (part, index) =>
        (index === 0 && part === 'this') ||
        this.validateJavaScriptIdentifier(part).length === 0
    );
  }

  static isSideEffectFreeExpression(expression: string): boolean {
    try {
      const ast = acorn.parse(`(${expression})`, { ecmaVersion: 'latest' });
      const forbiddenTypes = new Set([
        'AssignmentExpression',
        'AwaitExpression',
        'CallExpression',
        'NewExpression',
        'UpdateExpression',
        'YieldExpression',
      ]);
      let safe = true;

      const visit = (value: unknown): void => {
        if (!safe) return;
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!value || typeof value !== 'object') return;

        const node = value as { type?: string };
        if (node.type && forbiddenTypes.has(node.type)) {
          safe = false;
          return;
        }
        Object.values(value).forEach(visit);
      };

      visit(ast);
      return safe;
    } catch {
      return false;
    }
  }

  static validateJavaScriptIdentifier(identifier: string): CompilerError[] {
    const errors: CompilerError[] = [];

    if (!identifier || typeof identifier !== 'string') {
      errors.push({
        type: 'validation',
        message: 'Identifier cannot be empty',
      });
      return errors;
    }

    if (!VALID_JS_IDENTIFIER.test(identifier)) {
      errors.push({
        type: 'validation',
        message: `Invalid JavaScript identifier: ${identifier}`,
      });
    }

    if (RESERVED_WORDS.has(identifier)) {
      errors.push({
        type: 'validation',
        message: `Reserved word cannot be used as identifier: ${identifier}`,
      });
    }

    return errors;
  }

  static sanitizeString(input: string): string {
    if (typeof input !== 'string') {
      throw new Error('Input must be a string');
    }

    return input.replace(
      HTML_ESCAPE_PATTERN,
      (char) => HTML_ESCAPES.get(char) as string
    );
  }

  // Embed a runtime string into generated JavaScript source. This is the
  // only correct way to quote arbitrary text; escaping for a template
  // literal and then embedding inside quotes is an injection bug.
  static jsStringLiteral(value: string): string {
    return JSON.stringify(value);
  }

  static isAllowedSelector(selector: string): boolean {
    if (!selector || typeof selector !== 'string') {
      return false;
    }
    // CSS combinators, attribute selectors (including quoted values),
    // pseudo-classes/elements, selector lists and the universal selector.
    // Values are always embedded via jsStringLiteral, so quotes are safe;
    // reject only characters that smuggle markup or escape sequences
    // (`<`, backtick, backslash, braces).
    return /^[a-zA-Z0-9_#.[\]="':()\s>+~*,|^$%!-]+$/.test(selector);
  }

  static validateContent(content: string): CompilerError[] {
    const errors: CompilerError[] = [];

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        errors.push({
          type: 'security',
          message: `Potentially dangerous pattern detected: ${pattern.source}`,
        });
      }
    }

    return errors;
  }

  static validateFilePath(filePath: string): CompilerError[] {
    const errors: CompilerError[] = [];

    if (!filePath || typeof filePath !== 'string') {
      errors.push({
        type: 'validation',
        message: 'File path cannot be empty',
      });
      return errors;
    }

    // Check for path traversal attempts
    if (filePath.includes('..') || filePath.includes('~')) {
      errors.push({
        type: 'security',
        message: 'Path traversal attempt detected',
      });
    }

    // Check for absolute paths to sensitive directories
    const sensitiveDirectories = ['/etc', '/proc', '/sys', '/dev'];
    for (const dir of sensitiveDirectories) {
      if (filePath.startsWith(dir)) {
        errors.push({
          type: 'security',
          message: `Access to sensitive directory not allowed: ${dir}`,
        });
      }
    }

    return errors;
  }

  static validateFileExtension(
    filePath: string,
    allowedExtensions: string[]
  ): CompilerError[] {
    const errors: CompilerError[] = [];
    const extension = filePath.split('.').pop()?.toLowerCase();

    if (!extension || !allowedExtensions.includes(extension)) {
      errors.push({
        type: 'validation',
        message: `File extension not allowed. Allowed: ${allowedExtensions.join(', ')}`,
      });
    }

    return errors;
  }

  static escapeForTemplate(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  static validateNumericValue(value: string): CompilerError[] {
    const errors: CompilerError[] = [];

    if (!NUMERIC_VALUE.test(value)) {
      errors.push({
        type: 'validation',
        message: `Invalid numeric value: ${value}`,
      });
      return errors;
    }

    const num = parseFloat(value);
    if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
      errors.push({
        type: 'validation',
        message: `Numeric value out of safe range: ${value}`,
      });
    }

    return errors;
  }

  static validateHtmlAttribute(name: string, value: string): CompilerError[] {
    const errors: CompilerError[] = [];

    if (!/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/.test(name)) {
      errors.push({
        type: 'validation',
        message: `Invalid attribute name: ${name}`,
      });
    }

    const normalizedName = name.toLowerCase();
    if (
      EVENT_HANDLER_ATTRIBUTES.has(normalizedName) ||
      normalizedName === 'srcdoc'
    ) {
      errors.push({
        type: 'security',
        message: `Dangerous attribute not allowed: ${name}`,
      });
    }

    const urlAttributes = new Set([
      'action',
      'formaction',
      'href',
      'poster',
      'src',
      'xlink:href',
    ]);
    if (urlAttributes.has(normalizedName)) {
      const normalizedValue = Array.from(value)
        .filter((character) => character.charCodeAt(0) > 32)
        .join('')
        .toLowerCase();
      if (
        normalizedValue.startsWith('javascript:') ||
        normalizedValue.startsWith('vbscript:') ||
        normalizedValue.startsWith('data:text/html')
      ) {
        errors.push({
          type: 'security',
          message: `Dangerous URL not allowed in attribute: ${name}`,
        });
      }
    }

    // Validate the value parameter is used
    if (value && typeof value === 'string') {
      const valueErrors = this.validateContent(value);
      errors.push(...valueErrors);
    }

    return errors;
  }
}
