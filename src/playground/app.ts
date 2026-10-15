import type { CompilerResult } from '../types';
import {
  diagnosticExcerpt,
  Diagnostic,
  previewDocument,
  sourceOffset,
} from './preview';

interface Example {
  base: string;
  title: string;
  source: string;
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing playground element: ${id}`);
  return found as T;
}

const examples: Example[] = JSON.parse(
  element('playground-examples').textContent ?? '[]'
);
const source = element<HTMLTextAreaElement>('source');
const picker = element<HTMLSelectElement>('example');
const component = element<HTMLSelectElement>('preview-component');
const compileButton = element<HTMLButtonElement>('compile');
const status = element('compile-status');
const diagnostics = element('diagnostics');
const output = element('generated-code');
const preview = element('preview');
const runtime = element('runtime-status');
const drafts = new Map<string, string>();
let active: Example;
let worker: Worker | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let result: CompilerResult | undefined;
let frame: HTMLIFrameElement | undefined;
let token = '';

function clearPreview(): void {
  frame?.remove();
  frame = undefined;
  preview.textContent = 'Compile your source to see the result.';
  runtime.textContent = '';
  token = '';
}

function cancelCompile(): void {
  revision += 1;
  worker?.terminate();
  worker = undefined;
  clearTimeout(timeout);
  compileButton.disabled = false;
}

function invalidate(): void {
  cancelCompile();
  result = undefined;
  clearPreview();
  diagnostics.replaceChildren();
  output.textContent = '';
  component.replaceChildren();
  component.disabled = true;
}

function showDiagnostic(
  diagnostic: Diagnostic,
  severity: string,
  compiledSource: string
): void {
  const item = document.createElement('li');
  item.className = 'diagnostic';
  const offset = sourceOffset(compiledSource, diagnostic);
  const label = document.createElement(offset === null ? 'strong' : 'button');
  const location = diagnostic.line
    ? ` · ${diagnostic.source === 'generated' ? 'Generated JavaScript' : 'Source'} ${diagnostic.line}:${diagnostic.column ?? 1}`
    : '';
  const type = 'type' in diagnostic ? ` (${diagnostic.type})` : '';
  label.textContent = `${severity}${type}${location}${diagnostic.tag ? ` · <${diagnostic.tag.toLowerCase()}>` : ''}`;
  if (offset !== null) {
    label.addEventListener('click', () => {
      source.focus();
      source.setSelectionRange(offset, offset);
      source.scrollTop = Math.max(0, ((diagnostic.line ?? 1) - 4) * 21);
    });
  }
  const message = document.createElement('p');
  message.textContent = diagnostic.message;
  item.append(label, message);
  const excerpt = diagnosticExcerpt(compiledSource, diagnostic);
  if (excerpt !== null) {
    const snippet = document.createElement('pre');
    snippet.textContent = excerpt;
    item.append(snippet);
  }
  if (diagnostic.hint) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = `Hint: ${diagnostic.hint}`;
    item.append(hint);
  }
  diagnostics.append(item);
}

function runPreview(): void {
  clearPreview();
  if (!result?.success || !result.code || !component.value) return;
  token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  frame = document.createElement('iframe');
  frame.title = 'Component preview';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = previewDocument(result.code, component.value, token);
  preview.replaceChildren(frame);
  runtime.textContent = 'Starting preview…';
}

function compile(): void {
  invalidate();
  const current = revision;
  const compiledSource = source.value;
  if (new TextEncoder().encode(compiledSource).length > 256 * 1024) {
    status.textContent =
      'Source is too large. Keep playground examples under 256 KiB.';
    return;
  }
  status.textContent = 'Compiling…';
  compileButton.disabled = true;
  const fail = (message: string): void => {
    if (revision !== current) return;
    cancelCompile();
    status.textContent = message;
  };
  try {
    worker = new Worker('./playground-worker.js');
    worker.onerror = (): void =>
      fail('Compiler could not run. Reload the page or try compiling again.');
    worker.onmessage = (event: MessageEvent<CompilerResult>): void => {
      if (revision !== current) return;
      cancelCompile();
      result = event.data;
      for (const error of result.errors)
        showDiagnostic(error, 'Error', compiledSource);
      for (const warning of result.warnings)
        showDiagnostic(warning, 'Warning', compiledSource);
      if (!result.success || !result.code) {
        status.textContent = `Compilation failed · ${result.errors.length} error(s), ${result.warnings.length} warning(s).`;
        return;
      }
      output.textContent = result.code;
      for (const artifact of result.components ?? []) {
        component.add(new Option(`<${artifact.tagName}>`, artifact.tagName));
      }
      component.disabled = !component.options.length;
      status.textContent = `Compiled · ${result.warnings.length} warning(s).`;
      runPreview();
    };
    timeout = setTimeout(
      () =>
        fail(
          'Compilation timed out after 10 seconds. Shorten the source and try again.'
        ),
      10_000
    );
    worker.postMessage({ source: compiledSource });
  } catch {
    fail('Compiler could not start. Serve the demos over HTTP and reload.');
  }
}

function loadExample(): void {
  const requested = new URLSearchParams(location.hash.slice(1)).get('example');
  const example =
    examples.find((entry) => entry.base === requested) ??
    examples.find((entry) => entry.base === 'counter-component') ??
    examples[0];
  if (!example) return;
  if (active) drafts.set(active.base, source.value);
  active = example;
  picker.value = active.base;
  source.value = drafts.get(active.base) ?? active.source;
  compile();
}

for (const example of examples)
  picker.add(new Option(example.title, example.base));
picker.addEventListener('change', () => {
  location.hash = `example=${picker.value}`;
});
window.addEventListener('hashchange', () => {
  if (!new URLSearchParams(location.hash.slice(1)).has('example')) return;
  loadExample();
  element('playground').scrollIntoView({ block: 'start' });
});
for (const link of document.querySelectorAll<HTMLAnchorElement>(
  'a[href^="#example="]'
)) {
  link.addEventListener('click', () => {
    if (link.hash === location.hash)
      element('playground').scrollIntoView({ block: 'start' });
  });
}
source.addEventListener('input', () => {
  invalidate();
  status.textContent = 'Source changed. Compile to update the preview.';
});
source.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    compile();
  }
});
compileButton.addEventListener('click', compile);
element('reset').addEventListener('click', () => {
  source.value = active.source;
  drafts.delete(active.base);
  compile();
});
component.addEventListener('change', runPreview);
element('stop-preview').addEventListener('click', () => {
  if (worker) {
    cancelCompile();
    status.textContent = 'Compilation cancelled.';
  }
  clearPreview();
  runtime.textContent = 'Preview stopped. Compile to run it again.';
});
window.addEventListener('message', (event: MessageEvent) => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== 'null')
    return;
  const message = event.data;
  if (!message || message.type !== 'htms-preview' || message.token !== token)
    return;
  if (typeof message.error === 'string') {
    runtime.textContent = `Preview error: ${message.error.slice(0, 2000)}`;
  } else if (
    message.ready === true &&
    runtime.textContent === 'Starting preview…'
  ) {
    runtime.textContent = 'Preview running.';
  }
});
loadExample();
