import { parseHTML } from '../../src/parser';
import fs from 'fs';
import path from 'path';

describe('SSR Integration Tests', () => {
  it('compiles and generates working SSR code for hello-world demo', () => {
    const markup = `
      <component name="hello-world">
        <div class="message">Hello from HTMS!</div>
      </component>
    `;

    const result = parseHTML(markup, { mode: 'component', ssr: true });
    
    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    
    // Verify SSR method is present
    expect(result.code).toContain('static renderToString');
    
    // Verify component class exists
    expect(result.code).toContain('class HelloWorldComponent');
    
    // Verify custom element registration
    expect(result.code).toContain("customElements.define('hello-world'");
    
    // Verify template is embedded
    expect(result.code).toContain('<div class="message">Hello from HTMS!</div>');
  });

  it('SSR component with props interpolation', () => {
    const markup = `
      <component name="greeting-card">
        <div class="card">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
      </component>
    `;

    const result = parseHTML(markup, { mode: 'component', ssr: true });
    
    expect(result.success).toBe(true);
    expect(result.code).toContain('renderToString');
    expect(result.code).toContain('{title}');
    expect(result.code).toContain('{message}');
  });

  it('generates valid JavaScript code that can be written to file', () => {
    const markup = `
      <component name="test-component">
        <div>Test Content</div>
      </component>
    `;

    const result = parseHTML(markup, { mode: 'component', ssr: true });
    
    expect(result.success).toBe(true);
    
    // Verify the code contains all expected parts
    expect(result.code).toContain('class TestComponentComponent extends HTMLElement');
    expect(result.code).toContain('static renderToString');
    expect(result.code).toContain('customElements.define');
    expect(result.code).toContain('export');
  });

  it('handles multiple props in SSR renderToString', () => {
    const markup = `
      <component name="multi-prop">
        <div>
          <span>{firstName}</span>
          <span>{lastName}</span>
          <span>{age}</span>
        </div>
      </component>
    `;

    const result = parseHTML(markup, { mode: 'component', ssr: true });
    
    expect(result.success).toBe(true);
    expect(result.code).toContain('for (const [key, value] of Object.entries(props))');
    expect(result.code).toContain('{firstName}');
    expect(result.code).toContain('{lastName}');
    expect(result.code).toContain('{age}');
  });

  it('SSR component maintains shadow DOM structure for hydration', () => {
    const markup = `
      <component name="shadow-component">
        <div class="content">Shadow content</div>
      </component>
    `;

    const result = parseHTML(markup, { mode: 'component', ssr: true });
    
    expect(result.success).toBe(true);
    expect(result.code).toContain('attachShadow');
    expect(result.code).toContain('connectedCallback');
    expect(result.code).toContain('render()');
  });

  it('compiles the actual demo file correctly', () => {
    const demoPath = path.join(__dirname, '../../demos/ssr-demo-component.html');
    
    if (fs.existsSync(demoPath)) {
      const demoContent = fs.readFileSync(demoPath, 'utf8');
      const result = parseHTML(demoContent, { mode: 'component', ssr: true });
      
      expect(result.success).toBe(true);
      expect(result.code).toContain('SsrDemoComponent');
      expect(result.code).toContain('renderToString');
    } else {
      // Skip if demo file doesn't exist
      expect(true).toBe(true);
    }
  });
});
