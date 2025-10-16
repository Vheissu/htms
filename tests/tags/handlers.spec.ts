import { JSDOM } from 'jsdom';
import { handleCallTag } from '../../src/tags/call';
import { handleFunctionTag } from '../../src/tags/function';
import { handleShowTag } from '../../src/tags/show';
import { handleSubmitTag } from '../../src/tags/submit';
import { handleInjectTag } from '../../src/tags/inject';
import { handleKeyedListTag } from '../../src/tags/keyed-list';

function createElement(markup: string): Element {
  const dom = new JSDOM(`<body>${markup}</body>`);
  const element = dom.window.document.body.firstElementChild;
  if (!element) {
    throw new Error('Failed to create element for test');
  }
  return element;
}

describe('Tag handlers', () => {
  describe('CALL', () => {
    it('generates safe calls for whitelisted functions in strict mode', () => {
      const element = createElement('<CALL function="console.log" args="\'hello\', 42"></CALL>');
      const result = handleCallTag(element, { strictMode: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('console.log("hello", 42);');
    });

    it('rejects non-whitelisted functions in strict mode', () => {
      const element = createElement('<CALL function="evil.log"></CALL>');
      const result = handleCallTag(element, { strictMode: true });

      expect(result.errors.some(error => error.type === 'security')).toBe(true);
    });
  });

  describe('FUNCTION', () => {
    it('wraps user-defined functions with guarded bodies', () => {
      const element = createElement('<FUNCTION name="helper" params="value">return value;</FUNCTION>');
      const result = handleFunctionTag(element, { strictMode: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('function helper(value)');
      expect(result.code).toContain('console.error(\'Function helper execution error:\'');
    });

    it('rejects invalid parameter identifiers', () => {
      const element = createElement('<FUNCTION name="helper" params="123bad"></FUNCTION>');
      const result = handleFunctionTag(element, { strictMode: true });

      expect(result.errors.some(error => error.type === 'validation')).toBe(true);
    });
  });

  describe('SHOW', () => {
    it('maps SHOW directives to toggle visibility directives', () => {
      const element = createElement('<SHOW target="#panel" when="flag"></SHOW>');
      const result = handleShowTag(element, { parentContext: 'component' });

      expect(result.errors).toHaveLength(0);
      const directive = result.component?.directives?.[0];
      expect(directive).toBeDefined();
      expect(directive).toMatchObject({
        kind: 'visibility',
        selector: '#panel',
        condition: 'flag',
        mode: 'toggle'
      });
    });

    it('requires a target attribute', () => {
      const element = createElement('<SHOW when="flag"></SHOW>');
      const result = handleShowTag(element, { parentContext: 'component' });

      expect(result.errors.some(error => error.type === 'validation')).toBe(true);
    });
  });

  describe('SUBMIT', () => {
    it('creates guarded submit listeners', () => {
      const element = createElement('<SUBMIT target="#signup"><PRINT type="log">Submitted</PRINT></SUBMIT>');
      const result = handleSubmitTag(element, { strictMode: false });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain("addEventListener('submit'");
      expect(result.code).toContain('console.log');
    });

    it('validates required target selector', () => {
      const element = createElement('<SUBMIT></SUBMIT>');
      const result = handleSubmitTag(element, { strictMode: false });

      expect(result.errors.some(error => error.type === 'validation')).toBe(true);
    });
  });

  describe('INJECT', () => {
    it('is disabled by default for security', () => {
      const element = createElement('<INJECT selector="#target">Safe</INJECT>');
      const result = handleInjectTag(element, { strictMode: true });

      expect(result.errors.some(error => error.type === 'security')).toBe(true);
    });

    it('sanitizes content when explicitly enabled', () => {
      const previous = process.env.HTMS_ALLOW_INJECT_TAG;
      process.env.HTMS_ALLOW_INJECT_TAG = 'true';

      const element = createElement('<INJECT selector="#target">Safe</INJECT>');
      const result = handleInjectTag(element, { strictMode: false });

      process.env.HTMS_ALLOW_INJECT_TAG = previous;

      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some(warning => warning.message.includes('sanitized'))).toBe(true);
      expect(result.code).toContain('querySelectorAll');
      expect(result.code).toContain('textContent');
    });
  });

  describe('KEYEDLIST', () => {
    it('generates keyed rendering helpers', () => {
      const element = createElement(`
        <KEYEDLIST target="#items" of="items" item="item" index="i" key="item">
          <li class="entry">{item}</li>
        </KEYEDLIST>
      `);
      const result = handleKeyedListTag(element, { strictMode: false });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('window.__htms.keyedList');
      expect(result.code).toContain('data-key');
    });

    it('requires a single template child', () => {
      const element = createElement('<KEYEDLIST target="#items" of="items"></KEYEDLIST>');
      const result = handleKeyedListTag(element, { strictMode: false });

      expect(result.errors.some(error => error.type === 'validation')).toBe(true);
    });
  });
});
