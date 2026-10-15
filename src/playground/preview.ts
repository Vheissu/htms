import type { CompilerError, CompilerWarning } from '../types';

export type Diagnostic = CompilerError | CompilerWarning;

export function sourceOffset(
  source: string,
  diagnostic: Diagnostic
): number | null {
  if (diagnostic.source === 'generated' || !diagnostic.line) return null;
  const lines = source.split('\n');
  if (diagnostic.line < 1 || diagnostic.line > lines.length) return null;
  const line = lines.at(diagnostic.line - 1) ?? '';
  return (
    lines
      .slice(0, diagnostic.line - 1)
      .reduce((n, text) => n + text.length + 1, 0) +
    Math.min(line.length, Math.max(0, (diagnostic.column ?? 1) - 1))
  );
}

export function diagnosticExcerpt(
  source: string,
  diagnostic: Diagnostic
): string | null {
  if (sourceOffset(source, diagnostic) === null) return null;
  const line = source.split('\n').at((diagnostic.line ?? 1) - 1) ?? '';
  const column = Math.min(
    line.length,
    Math.max(0, (diagnostic.column ?? 1) - 1)
  );
  return `${line}\n${line.slice(0, column).replace(/[^\t]/g, ' ')}^`;
}

// The source and generated JavaScript never become markup in the parent page.
// A data module also keeps HTML parser tokens in string literals inert.
export function previewDocument(
  code: string,
  tagName: string,
  token: string
): string {
  if (
    !/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(tagName) ||
    !/^[a-z0-9-]+$/i.test(token)
  ) {
    throw new Error('Invalid preview metadata');
  }
  const script = `${code}\ndocument.body.append(document.createElement(${JSON.stringify(tagName)}));\nparent.postMessage({type: 'htms-preview', token: ${JSON.stringify(token)}, ready: true}, '*');`;
  const encoded = btoa(
    Array.from(new TextEncoder().encode(script), (byte) =>
      String.fromCharCode(byte)
    ).join('')
  );
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'">
<!-- Intersect policies so copying the nonce cannot authorize a remote script. -->
<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' data:">
<meta name="referrer" content="no-referrer">
<style>:root{color-scheme:light dark;font:16px/1.5 'Avenir Next',Avenir,'Segoe UI',sans-serif;color:#172033;background:#fff}body{margin:0;padding:24px;overflow-wrap:anywhere}button,input,select,textarea{font:inherit}button{cursor:pointer} @media(prefers-color-scheme:dark){:root{color:#edf0f6;background:#191f2a}}</style>
<script nonce="${token}">
const report = message => parent.postMessage({type:'htms-preview',token:'${token}',error:String(message).slice(0,2000)}, '*');
addEventListener('error', event => report(event.message));
addEventListener('unhandledrejection', event => report(event.reason));
addEventListener('securitypolicyviolation', event => report('Preview blocked ' + event.violatedDirective + '. External resources and network requests are disabled.'));
addEventListener('click', event => { if(event.composedPath().some(node => node instanceof HTMLAnchorElement)) event.preventDefault(); }, true);
</script></head><body><script type="module" nonce="${token}" src="data:text/javascript;base64,${encoded}"></script></body></html>`;
}
