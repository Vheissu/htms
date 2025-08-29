#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import { parseHTML } from '../src/parser';

const DEMOS_DIR = path.join(process.cwd(), 'demos');

function isHtmlDemo(name: string): boolean {
  if (!name.endsWith('.html')) return false;
  if (name.endsWith('.index.html')) return false;
  if (name === 'index.html') return false; // curated gallery page
  return true;
}

function buildDemo(file: string): void {
  const full = path.join(DEMOS_DIR, file);
  const html = fs.readFileSync(full, 'utf8');
  const res = parseHTML(html, { outputFormat: 'cjs' });
  if (!res.success || !res.code) {
    const msgs = res.errors.map(e => `${e.type}: ${e.message}`).join('\n  - ');
    throw new Error(`Failed to compile ${file}:\n  - ${msgs}`);
  }
  const base = file.replace(/\.html$/, '');
  const jsOut = path.join(DEMOS_DIR, `${base}.js`);
  fs.writeFileSync(jsOut, res.code, 'utf8');

  const idxPath = path.join(DEMOS_DIR, `${base}.index.html`);
  if (!fs.existsSync(idxPath)) {
    const htmlIndex = `<!doctype html><meta charset="utf-8"><title>${base}</title>
    <style>body{font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:24px}</style>
    <h2>${base}</h2>
    <p><a href="./">Back to demos/</a></p>
    <script src="./${base}.js"></script>`;
    fs.writeFileSync(idxPath, htmlIndex, 'utf8');
  }
  console.log(`✓ Built ${file} → ${base}.js`);
}

function main() {
  if (!fs.existsSync(DEMOS_DIR)) {
    console.error('No demos directory found');
    process.exit(1);
  }
  const entries = fs.readdirSync(DEMOS_DIR).filter(isHtmlDemo);
  if (entries.length === 0) {
    console.log('No demo .html files found.');
    return;
  }
  for (const file of entries) {
    try {
      buildDemo(file);
    } catch (err) {
      console.error(String(err));
      process.exitCode = 1;
    }
  }
  // Ensure curated gallery exists
  if (!fs.existsSync(path.join(DEMOS_DIR, 'index.html'))) {
    console.warn('Warning: demos/index.html is missing.');
  }
}

main();
