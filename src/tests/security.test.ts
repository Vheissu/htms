import { SecurityValidator } from '../utils/security';

describe('SecurityValidator', () => {
  describe('literal and expression helpers', () => {
    it('recognizes the supported decimal literal grammar', () => {
      for (const value of ['0', '-0', '42', '-12.5']) {
        expect(SecurityValidator.isNumericLiteral(value)).toBe(true);
      }
      for (const value of ['', '.5', '1.', '+1', '1e2', '--1']) {
        expect(SecurityValidator.isNumericLiteral(value)).toBe(false);
      }
    });

    it('recognizes plain JavaScript property paths', () => {
      for (const value of ['this', 'this.count', 'state.value', '$state._id']) {
        expect(SecurityValidator.isJavaScriptPath(value)).toBe(true);
      }
      for (const value of ['state[0]', 'bad-name', 'state..value', '1state']) {
        expect(SecurityValidator.isJavaScriptPath(value)).toBe(false);
      }
    });

    it('accepts declarative conditions and rejects expressions with effects', () => {
      expect(
        SecurityValidator.isSideEffectFreeExpression(
          'state.ready && count > 0 ? enabled : fallback'
        )
      ).toBe(true);
      for (const expression of [
        'loadData()',
        'count++',
        'count = 1',
        'new Date()',
        'await task',
      ]) {
        expect(SecurityValidator.isSideEffectFreeExpression(expression)).toBe(
          false
        );
      }
    });
  });

  describe('validateJavaScriptIdentifier', () => {
    it('should accept valid identifiers', () => {
      const validIds = [
        'validName',
        '_private',
        '$jquery',
        'camelCase',
        'snake_case',
      ];

      for (const id of validIds) {
        const errors = SecurityValidator.validateJavaScriptIdentifier(id);
        expect(errors).toHaveLength(0);
      }
    });

    it('should reject invalid identifiers', () => {
      const invalidIds = [
        '123invalid',
        'invalid-name',
        'invalid.name',
        '',
        '  ',
      ];

      for (const id of invalidIds) {
        const errors = SecurityValidator.validateJavaScriptIdentifier(id);
        expect(errors.length).toBeGreaterThan(0);
      }
    });

    it('should reject reserved words', () => {
      const reserved = [
        'function',
        'var',
        'let',
        'const',
        'if',
        'else',
        'for',
        'while',
      ];

      for (const word of reserved) {
        const errors = SecurityValidator.validateJavaScriptIdentifier(word);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain('Reserved word');
      }
    });

    it('should reject literals that cannot be binding names', () => {
      const literals = ['null', 'true', 'false'];

      for (const word of literals) {
        const errors = SecurityValidator.validateJavaScriptIdentifier(word);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message).toContain('Reserved word');
      }
    });
  });

  describe('validateContent', () => {
    it('should detect dangerous patterns', () => {
      const dangerous = [
        'eval("malicious code")',
        'document.write("<script>alert(1)</script>")',
        'setTimeout("alert(1)", 1000)',
        '<script>alert(1)</script>',
        'onclick="alert(1)"',
        '../../../etc/passwd',
        'javascript:alert(1)',
      ];

      for (const content of dangerous) {
        const errors = SecurityValidator.validateContent(content);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].type).toBe('security');
      }
    });

    it('should allow safe content', () => {
      const safe = [
        'Hello, world!',
        'console.log("Safe message")',
        'const x = 42;',
        '<div>Safe HTML</div>',
        'Math.max(1, 2, 3)',
      ];

      for (const content of safe) {
        const errors = SecurityValidator.validateContent(content);
        expect(errors).toHaveLength(0);
      }
    });
  });

  describe('validateFilePath', () => {
    it('should reject path traversal attempts', () => {
      const dangerous = [
        '../../../etc/passwd',
        '~/sensitive/file',
        '/etc/shadow',
      ];

      for (const path of dangerous) {
        const errors = SecurityValidator.validateFilePath(path);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].type).toBe('security');
      }
    });

    it('should allow safe paths', () => {
      const safe = ['./safe/file.html', 'demos/example.html', 'src/test.html'];

      for (const path of safe) {
        const errors = SecurityValidator.validateFilePath(path);
        expect(errors).toHaveLength(0);
      }
    });
  });

  describe('validateHtmlAttribute', () => {
    it('allows ordinary and namespaced attributes', () => {
      expect(
        SecurityValidator.validateHtmlAttribute('aria-label', 'Open')
      ).toHaveLength(0);
      expect(
        SecurityValidator.validateHtmlAttribute('xlink:href', '#icon')
      ).toHaveLength(0);
    });

    it('rejects event handlers, srcdoc, and executable URLs', () => {
      expect(
        SecurityValidator.validateHtmlAttribute('onfocus', 'steal()')[0].type
      ).toBe('security');
      expect(
        SecurityValidator.validateHtmlAttribute('srcdoc', '<p>unsafe</p>')[0]
          .type
      ).toBe('security');
      expect(
        SecurityValidator.validateHtmlAttribute(
          'href',
          ' java\nscript:steal()'
        )[0].type
      ).toBe('security');
    });
  });

  describe('escapeForTemplate', () => {
    it('should escape dangerous characters', () => {
      const input = '`${alert(1)}` \n\r\t\\';
      const escaped = SecurityValidator.escapeForTemplate(input);

      expect(escaped).toBe('\\`\\${alert(1)}\\` \\n\\r\\t\\\\');
    });
  });

  describe('validateNumericValue', () => {
    it('should accept valid numbers', () => {
      const valid = ['42', '3.14', '0', '-5'];

      for (const num of valid) {
        const errors = SecurityValidator.validateNumericValue(num);
        expect(errors).toHaveLength(0);
      }
    });

    it('should reject invalid numbers', () => {
      const invalid = ['abc', '1.2.3', 'NaN', 'Infinity', '', '1e10'];

      for (const num of invalid) {
        const errors = SecurityValidator.validateNumericValue(num);
        expect(errors.length).toBeGreaterThan(0);
      }
    });

    it('should reject numbers out of safe range', () => {
      const outOfRange = [
        (Number.MAX_SAFE_INTEGER + 1).toString(),
        (Number.MIN_SAFE_INTEGER - 1).toString(),
      ];

      for (const num of outOfRange) {
        const errors = SecurityValidator.validateNumericValue(num);
        expect(errors.length).toBeGreaterThan(0);
      }
    });
  });
});
