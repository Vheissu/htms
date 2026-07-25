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
    expect(result.code).toContain(
      'class LoggerBoxComponent extends HTMLElement'
    );
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
    expect(result.code).toContain('componentRoot.appendChild');
  });

  it('emits one export list for ESM component bundles', () => {
    const result = parseHTML(
      `
        <component name="format-first"><p>First</p></component>
        <component name="format-second"><p>Second</p></component>
      `,
      { outputFormat: 'esm' }
    );

    expect(result.success).toBe(true);
    expect(result.code?.match(/export\s*\{/g)).toHaveLength(1);
    expect(result.code).toContain(
      'export {\n  FormatFirstComponent,\n  FormatSecondComponent\n};'
    );
  });

  it('emits runnable CommonJS without ESM syntax', () => {
    const result = parseHTML(
      '<component name="commonjs-box"><p>CommonJS</p></component>',
      { outputFormat: 'cjs' }
    );

    expect(result.success).toBe(true);
    expect(result.code).not.toContain('export {');
    expect(result.code).toContain('module.exports');

    const module = { exports: {} as Record<string, unknown> };
    new Function('module', 'exports', result.code ?? '')(
      module,
      module.exports
    );
    expect(module.exports).toHaveProperty('CommonjsBoxComponent');
  });

  it('emits a runnable IIFE with classes on the HTMS namespace', () => {
    const result = parseHTML(
      '<component name="iife-box"><p>IIFE</p></component>',
      { outputFormat: 'iife' }
    );

    expect(result.success).toBe(true);
    expect(result.code).not.toContain('export {');
    expect(result.code).toContain('globalThis.HTMSComponents');
    new Function(result.code ?? '')();

    const runtimeGlobal = globalThis as typeof globalThis & {
      HTMSComponents?: Record<string, unknown>;
    };
    expect(runtimeGlobal.HTMSComponents).toHaveProperty('IifeBoxComponent');
    delete runtimeGlobal.HTMSComponents;
  });

  it('reports source locations and a suggestion for misspelled tags', () => {
    const result = parseHTML(
      `<component name="diagnostic-box">
  <p>Before</p>
  <repaet count="2"><span>Again</span></repaet>
</component>`,
      { strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        type: 'validation',
        tag: 'REPAET',
        line: 3,
        column: 3,
        source: 'input',
        hint: 'Did you mean <repeat>?',
      })
    );
  });
});

describe('getTopLevelElements', () => {
  it('extracts top-level elements from valid HTML', () => {
    const htmlContent = '<div><p>Test</p></div><span>Another Test</span>';
    const elements = getTopLevelElements(htmlContent);
    expect(elements.length).toBe(2);
  });
});
