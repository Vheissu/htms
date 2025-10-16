import { JSDOM } from 'jsdom';
import { handleCallTag } from '../../src/tags/call';
import { handleFunctionTag } from '../../src/tags/function';
import { handleShowTag } from '../../src/tags/show';
import { handleSubmitTag } from '../../src/tags/submit';
import { handleInjectTag } from '../../src/tags/inject';
import { handleKeyedListTag } from '../../src/tags/keyed-list';
import { handleEffectTag } from '../../src/tags/effect';
import { handleFetchTag } from '../../src/tags/fetch';

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

  describe('EFFECT', () => {
    it('registers runtime effects using run attribute', () => {
      const element = createElement('<EFFECT run="console.log(count)"></EFFECT>');
      const result = handleEffectTag(element, { strictMode: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('registerEffect');
      expect(result.code).toContain('console.log(count');
    });

    it('supports dependency lists and component ownership', () => {
      const element = createElement('<EFFECT deps="user.id, token" immediate="false" once="true">cleanupFlag = true</EFFECT>');
      const result = handleEffectTag(element, { strictMode: true, componentContext: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('owner: owner');
      expect(result.code).toContain('deps: [function(){ return user.id; }, function(){ return token; }]');
      expect(result.code).toContain('immediate: false');
      expect(result.code).toContain('once: true');
      expect(result.code).toContain('cleanupFlag = true');
    });

    it('accepts cleanup attribute and guards invalid content', () => {
      const element = createElement('<EFFECT run="doWork()" cleanup="tearDown()"></EFFECT>');
      const result = handleEffectTag(element, { strictMode: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('cleanup: function()');
      expect(result.code).toContain('tearDown()');
    });

    it('requires effect body', () => {
      const element = createElement('<EFFECT></EFFECT>');
      const result = handleEffectTag(element, { strictMode: true });

      expect(result.errors.some(error => error.type === 'validation')).toBe(true);
    });
  });

  describe('FETCH', () => {
    it('generates guarded fetch effect', () => {
      const element = createElement('<FETCH url="buildUrl(userId)" into="state.items" loading="state.loading"></FETCH>');
      const result = handleFetchTag(element, { strictMode: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('registerEffect');
      expect(result.code).toContain('fetch(');
      expect(result.code).toContain('runtime.notify');
    });

    it('wires component state targets and conditional guard', () => {
      const element = createElement(
        '<FETCH url="this.buildUrl()" method="post" body="payload" headers="makeHeaders()" into="state.data" error="state.error" loading="state.loading" when="shouldLoad" immediate="false" once="true"></FETCH>'
      );
      const result = handleFetchTag(element, { strictMode: true, componentContext: true });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('})(this);');
      expect(result.code).toContain("method: 'POST'");
      expect(result.code).toContain("target['state']");
      expect(result.code).toContain('immediate: false');
      expect(result.code).toContain('once: true');
      expect(result.code).toContain('if (!shouldRun)');
    });

    it('validates url presence', () => {
      const element = createElement('<FETCH></FETCH>');
      const result = handleFetchTag(element, { strictMode: true });

      expect(result.errors.some(error => error.type === 'validation')).toBe(true);
    });

    it('rejects unsupported methods', () => {
      const element = createElement('<FETCH url="/api" method="trace"></FETCH>');
      const result = handleFetchTag(element, { strictMode: true });

      expect(result.errors.some(error => error.message.includes('Unsupported HTTP method'))).toBe(true);
    });
  });
});
