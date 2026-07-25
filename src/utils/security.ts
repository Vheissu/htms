import validator from 'validator';
import * as esprima from 'esprima';
import { CompilerError } from '../types';

const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /document\.write/,
  /innerHTML\s*=/,
  /outerHTML\s*=/,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
  /<script/i,
  /(?:^|[\s<])on\w+\s*=/i,
  /\.\.\//,
  /~\//,
  /\/proc\//,
  /\/etc\//,
];

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
      const ast = esprima.parseScript(`(${expression})`);
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

    return validator.escape(input);
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

    if (!validator.isNumeric(value)) {
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
    if (normalizedName.startsWith('on') || normalizedName === 'srcdoc') {
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
