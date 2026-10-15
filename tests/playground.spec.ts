import { parseHTML } from '../src/parser';
import {
  diagnosticExcerpt,
  previewDocument,
  sourceOffset,
} from '../src/playground/preview';

describe('playground diagnostics', () => {
  const source = '<component name="counter-box">\n  <var></var>\n</component>';

  it('uses compiler input positions and hints without translating them', () => {
    const result = parseHTML(source, { mode: 'component', strictMode: true });
    expect(result.success).toBe(false);
    const diagnostic = result.errors.find((error) => error.line === 2);
    expect(diagnostic).toBeDefined();
    expect(sourceOffset(source, diagnostic!)).toBe(source.indexOf('<var>'));
    expect(diagnosticExcerpt(source, diagnostic!)).toBe('  <var></var>\n  ^');
  });

  it('never maps generated JavaScript locations onto HTML source', () => {
    const error = {
      message: 'Syntax error',
      line: 2,
      column: 3,
      source: 'generated' as const,
    };
    expect(sourceOffset(source, error)).toBeNull();
    expect(diagnosticExcerpt(source, error)).toBeNull();
    expect(sourceOffset(source, { message: 'No location' })).toBeNull();
    expect(
      sourceOffset(source, { message: 'Outside input', line: 99 })
    ).toBeNull();
  });

  it('handles tabs, CRLF and columns past the end of a line', () => {
    const input = 'first\r\n\tsecond';
    expect(sourceOffset(input, { message: '', line: 2, column: 2 })).toBe(8);
    expect(diagnosticExcerpt(input, { message: '', line: 2, column: 2 })).toBe(
      '\tsecond\n\t^'
    );
    expect(sourceOffset(input, { message: '', line: 2, column: 99 })).toBe(
      input.length
    );
  });
});

describe('preview document', () => {
  it('encodes Unicode and HTML parser escape sequences as module data', () => {
    const code =
      'const text = "</script><script>parent.bad = true</script> ☀";';
    const html = previewDocument(code, 'my-element', 'preview-123');
    expect(html).not.toContain(code);
    const encoded = html.match(
      /src="data:text\/javascript;base64,([^"]+)"/
    )?.[1];
    expect(Buffer.from(encoded!, 'base64').toString('utf8')).toContain(code);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("script-src 'nonce-preview-123'");
    expect(html).not.toContain('unsafe-eval');
  });

  it('rejects markup in component names and nonce tokens', () => {
    expect(() => previewDocument('', 'bad"><script>', 'token')).toThrow();
    expect(() => previewDocument('', 'my-element', 'bad"')).toThrow();
  });
});
