import { parseHTML } from '../../src/parser';
import { renderComponentToString } from '../../src/ssr/renderer';
import { ComponentIR } from '../../src/component/ir';

describe('SSR Renderer', () => {
  describe('renderComponentToString', () => {
    it('renders simple template to HTML string', () => {
      const ir: ComponentIR = {
        templateNodes: [
          {
            type: 'element',
            tagName: 'div',
            attributes: { class: 'message' },
            children: [
              { type: 'text', textContent: 'Hello World' }
            ]
          }
        ],
        directives: []
      };

      const result = renderComponentToString(ir);
      expect(result.errors).toHaveLength(0);
      expect(result.html).toBe('<div class="message">Hello World</div>');
    });

    it('interpolates variables in text content', () => {
      const ir: ComponentIR = {
        templateNodes: [
          {
            type: 'element',
            tagName: 'div',
            children: [
              { type: 'text', textContent: 'Hello {name}' }
            ]
          }
        ],
        directives: []
      };

      const result = renderComponentToString(ir, { props: { name: 'World' } });
      expect(result.errors).toHaveLength(0);
      expect(result.html).toBe('<div>Hello World</div>');
    });

    it('escapes HTML in text content', () => {
      const ir: ComponentIR = {
        templateNodes: [
          {
            type: 'text',
            textContent: '<script>alert("xss")</script>'
          }
        ],
        directives: []
      };

      const result = renderComponentToString(ir);
      expect(result.errors).toHaveLength(0);
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).not.toContain('<script>');
    });

    it('handles nested elements', () => {
      const ir: ComponentIR = {
        templateNodes: [
          {
            type: 'element',
            tagName: 'div',
            attributes: { id: 'parent' },
            children: [
              {
                type: 'element',
                tagName: 'span',
                children: [
                  { type: 'text', textContent: 'Nested' }
                ]
              }
            ]
          }
        ],
        directives: []
      };

      const result = renderComponentToString(ir);
      expect(result.errors).toHaveLength(0);
      expect(result.html).toBe('<div id="parent"><span>Nested</span></div>');
    });

    it('handles self-closing tags', () => {
      const ir: ComponentIR = {
        templateNodes: [
          {
            type: 'element',
            tagName: 'img',
            attributes: { src: 'test.jpg', alt: 'Test' }
          }
        ],
        directives: []
      };

      const result = renderComponentToString(ir);
      expect(result.errors).toHaveLength(0);
      expect(result.html).toBe('<img src="test.jpg" alt="Test" />');
    });
  });

  describe('SSR compilation', () => {
    it('compiles component with SSR mode enabled', () => {
      const markup = `
        <component name="hello-world">
          <div class="message">Hello from HTMS!</div>
        </component>
      `;

      const result = parseHTML(markup, { mode: 'component', ssr: true });
      if (!result.success) {
        console.log('Errors:', result.errors);
        console.log('Warnings:', result.warnings);
      }
      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
      expect(result.code).toContain('renderToString');
      expect(result.code).toContain('class HelloWorldComponent');
    });

    it('includes static template in SSR component', () => {
      const markup = `
        <component name="static-component">
          <h1>Title</h1>
          <p>Content</p>
        </component>
      `;

      const result = parseHTML(markup, { mode: 'component', ssr: true });
      expect(result.success).toBe(true);
      expect(result.code).toContain('<h1>Title</h1>');
      expect(result.code).toContain('<p>Content</p>');
    });

    it('generates hydration-compatible code', () => {
      const markup = `
        <component name="counter-app">
          <div id="count">0</div>
          <button id="inc">Increment</button>
        </component>
      `;

      const result = parseHTML(markup, { mode: 'component', ssr: true });
      expect(result.success).toBe(true);
      expect(result.code).toContain('renderToString');
      expect(result.code).toContain('connectedCallback');
    });
  });
});
