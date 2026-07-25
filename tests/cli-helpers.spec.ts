import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildPreviewHtml,
  compileFile,
  createStarterComponent,
  extractComponentTagName,
  resolveDeclarationPath,
  resolveOutputPath,
  validateFile,
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
      reloadEndpoint: '/__htms_reload',
    });
    expect(html).toContain('<demo-widget></demo-widget>');
    expect(html).toContain('src="/demo-widget.js"');
    expect(html).toContain('EventSource');
    expect(html).toContain('HTMS preview');
    expect(html).toContain('__htms_diagnostics');
    expect(html).toContain('rel="icon"');
  });

  it('safely includes initial diagnostics in the preview', () => {
    const html = buildPreviewHtml({
      tagName: 'demo-widget',
      scriptPath: '/demo-widget.js',
      enableReload: true,
      diagnostics: [
        {
          level: 'error',
          message: '</script><script>alert("nope")</script>',
          line: 3,
          hint: 'Fix the tag.',
        },
      ],
    });

    expect(html).toContain('\\u003c/script>');
    expect(html).not.toContain('</script><script>alert("nope")');
    expect(html).toContain('showDiagnostics');
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
      mode: 'component',
    });

    expect(result.success).toBe(true);
    const outputPath = resolveOutputPath(inputPath);
    const declarationPath = resolveDeclarationPath(outputPath);
    const output = await fs.readFile(outputPath, 'utf8');
    const declarations = await fs.readFile(declarationPath, 'utf8');
    expect(output).toContain("customElements.define('demo-widget'");
    expect(declarations).toContain(
      'export declare class DemoWidgetComponent extends HTMLElement'
    );
    expect(declarations).toContain('"demo-widget": DemoWidgetComponent;');
  });

  it('creates an interactive starter that passes full validation', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-create-'));
    const outputPath = path.join(tmpDir, 'click-counter.html');

    const created = await createStarterComponent('click-counter', {
      outputPath,
    });
    const validation = await validateFile(outputPath, 1024 * 1024);
    const source = await fs.readFile(outputPath, 'utf8');

    expect(created).toEqual(
      expect.objectContaining({
        success: true,
        outputPath,
        tagName: 'click-counter',
      })
    );
    expect(source).toContain('<output aria-live="polite">{count}</output>');
    expect(source).toContain('<set name="count" op="++"></set>');
    expect(validation.success).toBe(true);
    expect(
      validation.components?.map((component) => component.tagName)
    ).toEqual(['click-counter']);
  });

  it('does not replace an existing starter unless force is explicit', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-create-'));
    const outputPath = path.join(tmpDir, 'safe-counter.html');
    await fs.writeFile(outputPath, 'keep me', 'utf8');

    const result = await createStarterComponent('safe-counter', {
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        message: `File already exists: ${outputPath}`,
      })
    );
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('keep me');
  });

  it('runs compiler validation without writing JavaScript', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-validate-'));
    const inputPath = path.join(tmpDir, 'broken.html');
    await fs.writeFile(
      inputPath,
      `<component name="broken-box">
  <repaet count="2"></repaet>
</component>`,
      'utf8'
    );

    const result = await validateFile(inputPath, 1024 * 1024);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toEqual(
      expect.objectContaining({
        line: 2,
        column: 3,
        hint: 'Did you mean <repeat>?',
      })
    );
    await expect(
      fs.access(path.join(tmpDir, 'broken.js'))
    ).rejects.toBeDefined();
  });
});
