#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import { parseHTML } from '../src/parser';

const DEMOS_DIR = path.join(process.cwd(), 'demos');
const COMPONENT_SUFFIX = '-component.html';

interface CompiledDemo {
  base: string;
  tagName: string;
  title: string;
}

function titleCase(value: string): string {
  return value
    .replace(/-component$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function ensureDir(): void {
  if (!fs.existsSync(DEMOS_DIR)) {
    throw new Error('No demos directory found');
  }
}

function discover(): string[] {
  return fs
    .readdirSync(DEMOS_DIR)
    .filter(name => name.endsWith(COMPONENT_SUFFIX));
}

function extractTagName(html: string, file: string): string {
  const match = html.match(/<component[^>]*name="([a-z0-9-]+)"/i);
  if (!match) {
    throw new Error(`Component name not found in ${file}`);
  }
  return match[1];
}

function buildDemo(file: string): CompiledDemo {
  const full = path.join(DEMOS_DIR, file);
  const html = fs.readFileSync(full, 'utf8');
  const tagName = extractTagName(html, file);

  const result = parseHTML(html, { mode: 'component', outputFormat: 'esm' });
  if (!result.success || !result.code) {
    const msgs = result.errors.map(e => `${e.type}: ${e.message}`).join('\n  - ');
    throw new Error(`Failed to compile ${file}:\n  - ${msgs}`);
  }

  const base = file.replace(/\.html$/, '');
  const jsOut = path.join(DEMOS_DIR, `${base}.js`);
  fs.writeFileSync(jsOut, result.code, 'utf8');

  const previewPath = path.join(DEMOS_DIR, `${base}.preview.html`);
  const previewHtml = `<!doctype html>\n<meta charset="utf-8">\n<title>${titleCase(base)}</title>\n<style>\n  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 32px; line-height: 1.5; }\n  main { display: grid; gap: 24px; }\n  .todo, .box, .form { display: grid; gap: 12px; max-width: 420px; }\n  .todo .input-row { display: flex; gap: 8px; }\n  .todo input { flex: 1 1 auto; }\n  ul { padding-left: 18px; }\n  button { cursor: pointer; }\n  .badge { margin-left: 8px; font-size: 12px; padding: 2px 6px; border-radius: 999px; background: #2563eb; color: white; }\n  .badge-muted { background: #94a3b8; }\n</style>\n<main>\n  <${tagName}></${tagName}>\n</main>\n<script type="module" src="./${base}.js"></script>`;
  fs.writeFileSync(previewPath, previewHtml, 'utf8');

  console.log(`✓ Built ${file} → ${base}.js`);
  return { base, tagName, title: titleCase(base) };
}

function writeGallery(demos: CompiledDemo[]): void {
  const items = demos
    .map(({ base, title }) => `    <li><a href="./${base}.preview.html">${title}</a></li>`)
    .join('\n');

  const gallery = `<!doctype html>\n<meta charset="utf-8">\n<title>HTMS Component Demos</title>\n<style>\n  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 48px; max-width: 640px; }\n  h1 { font-size: 28px; margin-bottom: 12px; }\n  p { color: #475569; }\n  ul { padding-left: 20px; line-height: 1.6; }\n</style>\n<h1>HTMS Component Demos</h1>\n<p>Each link opens a standalone page that registers the compiled custom element and mounts it once.</p>\n<ul>\n${items}\n</ul>`;

  fs.writeFileSync(path.join(DEMOS_DIR, 'index.html'), gallery, 'utf8');
}

function main(): void {
  ensureDir();
  const entries = discover();
  if (entries.length === 0) {
    console.warn('No *-component.html demos found.');
    return;
  }

  const compiled: CompiledDemo[] = [];
  for (const file of entries) {
    compiled.push(buildDemo(file));
  }

  writeGallery(compiled);
}

main();
