import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildPreviewHtml,
  compileFile,
  extractComponentTagName,
  resolveOutputPath
} from '../src/cli-helpers';

describe('CLI helpers', () => {
  it('extracts component tag names', () => {
    const markup = '<component name="demo-widget"><div></div></component>';
    expect(extractComponentTagName(markup)).toBe('demo-widget');
  });

  it('builds preview HTML with live reload', () => {
    const html = buildPreviewHtml({
      tagName: 'demo-widget',
      scriptPath: '/demo-widget.js',
      enableReload: true,
      reloadEndpoint: '/__htms_reload'
    });
    expect(html).toContain('<demo-widget></demo-widget>');
    expect(html).toContain('src="/demo-widget.js"');
    expect(html).toContain('EventSource');
  });

  it('compiles a file and writes output', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-cli-'));
    const inputPath = path.join(tmpDir, 'widget.html');
    const html = `
      <component name="demo-widget">
        <div class="wrapper">Hi</div>
      </component>
    `;
    await fs.writeFile(inputPath, html, 'utf8');

    const result = await compileFile(inputPath, {
      format: 'esm',
      strict: false,
      maxSize: 1024 * 1024,
      mode: 'component'
    });

    expect(result.success).toBe(true);
    const outputPath = resolveOutputPath(inputPath);
    const output = await fs.readFile(outputPath, 'utf8');
    expect(output).toContain("customElements.define('demo-widget'");
  });
});
