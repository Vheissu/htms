import { parseHTML } from '../parser';
import { ParseOptions } from '../types';

function compileComponent(markup: string, options: ParseOptions = {}) {
  return parseHTML(markup, { mode: 'component', outputFormat: 'esm', ...options });
}

describe('Parser (component mode)', () => {
  it('compiles components containing PRINT directives', () => {
    const html = `
      <component name="logger-box">
        <PRINT type="log">Hello World</PRINT>
      </component>
    `;

    const result = compileComponent(html);

    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    expect(result?.code).toContain('class LoggerBoxComponent extends HTMLElement');
    expect(result?.code).toContain('console.log');
  });

  it('emits state helpers for VAR and SET directives', () => {
    const html = `
      <component name="counter-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="increment">+</button>
        <event target="#increment" type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `;

    const result = compileComponent(html);

    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    expect(result?.code).toContain("this.__htmsInitState(['count'], () => 0);");
    expect(result?.code).toContain("this.__htmsSetState(['count'], '++'");
  });

  it('rejects documents without a <component> root', () => {
    const result = compileComponent('<div>oops</div>');

    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain('Wrap markup in a <component>');
  });

  it('rejects component names without a hyphen', () => {
    const html = `
      <component name="invalid">
        <div>Nope</div>
      </component>
    `;

    const result = compileComponent(html);

    expect(result.success).toBe(false);
    expect(result.errors.some(error => error.message.includes('must include a hyphen'))).toBe(true);
  });

  it('rejects dangerous content in strict mode', () => {
    const html = `
      <component name="danger-box">
        <PRINT type="log">document.write("x")</PRINT>
      </component>
    `;

    const result = compileComponent(html, { strictMode: true });

    expect(result.success).toBe(false);
    expect(result.errors.some(error => error.type === 'security')).toBe(true);
  });
});
