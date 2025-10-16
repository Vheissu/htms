import { getTopLevelElements, parseHTML } from '../src/parser';

describe('parseHTML', () => {
  it('parses a simple PRINT tag correctly', () => {
    const htmlContent = `
      <component name="logger-box">
        <PRINT type="log">Hello World</PRINT>
      </component>
    `;

    const result = parseHTML(htmlContent);

    expect(result.success).toBe(true);
    expect(result.code).toContain('class LoggerBoxComponent extends HTMLElement');
    expect(result.code).toContain('console.log');
  });

  it('compiles a basic component in component mode', () => {
    const htmlContent = `
      <component name="demo-box">
        <div class="box">Demo</div>
      </component>
    `;

    const result = parseHTML(htmlContent, { mode: 'component' });

    expect(result.success).toBe(true);
    expect(result.code).toContain('class DemoBoxComponent extends HTMLElement');
    expect(result.code).toContain("customElements.define('demo-box'");
    expect(result.code).toContain("componentRoot.appendChild");
  });
});

describe('getTopLevelElements', () => {
  it('extracts top-level elements from valid HTML', () => {
    const htmlContent = '<div><p>Test</p></div><span>Another Test</span>';
    const elements = getTopLevelElements(htmlContent);
    expect(elements.length).toBe(2);
  });
});
