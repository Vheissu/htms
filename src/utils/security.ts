import validator from 'validator';
import { CompilerError } from '../types';

const DANGEROUS_PATTERNS = [
  /eval\s*\(/,
  /Function\s*\(/,
  /setTimeout\s*\(/,
  /setInterval\s*\(/,
  /document\.write/,
  /innerHTML\s*=/,
  /outerHTML\s*=/,
  /javascript:/,
  /<script/i,
  /on\w+\s*=/i,
  /\.\.\//,
  /~\//,
  /\/proc\//,
  /\/etc\//,
];

const VALID_JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch',
  'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'async', 'await', 'static', 'enum', 'implements', 'interface', 'package',
  'private', 'protected', 'public'
]);

export class SecurityValidator {
  static validateJavaScriptIdentifier(identifier: string): CompilerError[] {
    const errors: CompilerError[] = [];

    if (!identifier || typeof identifier !== 'string') {
      errors.push({
        type: 'validation',
        message: 'Identifier cannot be empty'
      });
      return errors;
    }

    if (!VALID_JS_IDENTIFIER.test(identifier)) {
      errors.push({
        type: 'validation',
        message: `Invalid JavaScript identifier: ${identifier}`
      });
    }

    if (RESERVED_WORDS.has(identifier)) {
      errors.push({
        type: 'validation',
        message: `Reserved word cannot be used as identifier: ${identifier}`
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
          message: `Potentially dangerous pattern detected: ${pattern.source}`
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
        message: 'File path cannot be empty'
      });
      return errors;
    }

    // Check for path traversal attempts
    if (filePath.includes('..') || filePath.includes('~')) {
      errors.push({
        type: 'security',
        message: 'Path traversal attempt detected'
      });
    }

    // Check for absolute paths to sensitive directories
    const sensitiveDirectories = ['/etc', '/proc', '/sys', '/dev'];
    for (const dir of sensitiveDirectories) {
      if (filePath.startsWith(dir)) {
        errors.push({
          type: 'security',
          message: `Access to sensitive directory not allowed: ${dir}`
        });
      }
    }

    return errors;
  }

  static validateFileExtension(filePath: string, allowedExtensions: string[]): CompilerError[] {
    const errors: CompilerError[] = [];
    const extension = filePath.split('.').pop()?.toLowerCase();

    if (!extension || !allowedExtensions.includes(extension)) {
      errors.push({
        type: 'validation',
        message: `File extension not allowed. Allowed: ${allowedExtensions.join(', ')}`
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
        message: `Invalid numeric value: ${value}`
      });
      return errors;
    }

    const num = parseFloat(value);
    if (num > Number.MAX_SAFE_INTEGER) {
      errors.push({
        type: 'validation',
        message: `Numeric value out of safe range: ${value}`
      });
    }

    return errors;
  }

  static validateHtmlAttribute(name: string, value: string): CompilerError[] {
    const errors: CompilerError[] = [];

    if (!validator.isAlphanumeric(name.replace(/[-_]/g, ''))) {
      errors.push({
        type: 'validation',
        message: `Invalid attribute name: ${name}`
      });
    }

    // Check for dangerous attribute values
    const dangerousAttrs = ['onclick', 'onload', 'onerror', 'onmouseover'];
    if (dangerousAttrs.includes(name.toLowerCase())) {
      errors.push({
        type: 'security',
        message: `Dangerous attribute not allowed: ${name}`
      });
    }

    // Validate the value parameter is used
    if (value && typeof value === 'string') {
      const valueErrors = this.validateContent(value);
      errors.push(...valueErrors);
    }

    return errors;
  }
}