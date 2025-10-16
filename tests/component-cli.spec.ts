import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProgram } from '../src/cli';

describe('CLI component mode', () => {
  it('emits a custom element when using --mode component', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-cli-'));
    const inputPath = path.join(tmpDir, 'component.html');
    const outputPath = path.join(tmpDir, 'component.js');

    const html = `
      <component name="demo-widget">
        <div class="wrapper">Demo</div>
      </component>
    `;

    await fs.writeFile(inputPath, html, 'utf8');

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'htms',
      'compile',
      inputPath,
      '--mode',
      'component',
      '--output',
      outputPath
    ]);

    const output = await fs.readFile(outputPath, 'utf8');
    expect(output).toContain("class DemoWidgetComponent extends HTMLElement");
    expect(output).toContain("customElements.define('demo-widget'");
  });
});
