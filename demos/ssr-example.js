/**
 * Example: Server-Side Rendering with htms
 * 
 * This example demonstrates how to use the SSR functionality
 * to render htms components on the server.
 */

// Option 1: Using compiled component's renderToString
// After compiling with --ssr flag, you can use:
/*
import { SsrDemoComponent } from './ssr-demo.js';

const html = SsrDemoComponent.renderToString({ 
  timestamp: new Date().toISOString() 
});

console.log('Server-rendered HTML:', html);
*/

// Option 2: Using renderComponentToString from IR
/*
import { renderComponentToString } from 'htms/ssr';
import { ComponentIR } from 'htms';

const componentIR: ComponentIR = {
  templateNodes: [
    {
      type: 'element',
      tagName: 'div',
      children: [
        { type: 'text', textContent: 'Hello {name}!' }
      ]
    }
  ],
  directives: []
};

const result = renderComponentToString(componentIR, {
  props: { name: 'World' }
});

console.log('Rendered HTML:', result.html);
*/

// Option 3: Complete Express.js example
/*
import express from 'express';
import { SsrDemoComponent } from './ssr-demo.js';

const app = express();

app.get('/', (req, res) => {
  const timestamp = new Date().toISOString();
  const componentHtml = SsrDemoComponent.renderToString({ timestamp });
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>SSR Demo</title>
      </head>
      <body>
        <ssr-demo timestamp="${timestamp}">${componentHtml}</ssr-demo>
        <script type="module" src="/ssr-demo.js"></script>
      </body>
    </html>
  `;
  
  res.send(html);
});

app.listen(3000, () => {
  console.log('SSR demo server running on http://localhost:3000');
});
*/

console.log('SSR examples are commented out above. Uncomment to use them.');
