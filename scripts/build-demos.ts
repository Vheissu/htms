#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';
import { parseHTML } from '../src/parser';

const DEMOS_DIR = path.join(process.cwd(), 'demos');
const COMPONENT_SUFFIX = '-component.html';
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E";

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
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
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
    .filter((name) => name.endsWith(COMPONENT_SUFFIX));
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
    const msgs = result.errors
      .map((e) => `${e.type}: ${e.message}`)
      .join('\n  - ');
    throw new Error(`Failed to compile ${file}:\n  - ${msgs}`);
  }

  const base = file.replace(/\.html$/, '');
  const jsOut = path.join(DEMOS_DIR, `${base}.js`);
  fs.writeFileSync(jsOut, result.code, 'utf8');

  const previewPath = path.join(DEMOS_DIR, `${base}.preview.html`);
  const title = titleCase(base);
  const previewHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="${FAVICON}">
  <title>${title} | HTMS Demo</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #f6f7fb;
      --surface: #ffffff;
      --ink: #172033;
      --muted: #5d687a;
      --line: #dfe3ec;
      --accent: #d94828;
      font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      min-height: 100dvh;
      margin: 0;
      color: var(--ink);
      background: var(--page);
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: min(100% - 2rem, 72rem);
      min-height: 4.5rem;
      margin: auto;
      border-bottom: 1px solid var(--line);
    }

    header a {
      color: var(--ink);
      font-weight: 750;
      text-decoration: none;
    }

    header span {
      color: var(--muted);
      font-size: 0.875rem;
    }

    main {
      display: grid;
      width: min(100% - 2rem, 72rem);
      min-height: calc(100dvh - 8.5rem);
      margin: auto;
      padding: clamp(2rem, 8vw, 7rem) 0;
      place-items: center;
    }

    .stage {
      width: min(100%, 48rem);
      padding: clamp(1.25rem, 5vw, 3.5rem);
      border: 1px solid var(--line);
      border-radius: 1rem;
      background: var(--surface);
      box-shadow: 0 1.5rem 4rem rgb(44 53 72 / 10%);
    }

    footer {
      width: min(100% - 2rem, 72rem);
      margin: auto;
      padding: 1rem 0 2rem;
      color: var(--muted);
      font: 0.8125rem/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace;
    }

    :focus-visible {
      outline: 3px solid color-mix(in srgb, var(--accent) 70%, transparent);
      outline-offset: 4px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --page: #11151d;
        --surface: #191f2a;
        --ink: #edf0f6;
        --muted: #a7b0c1;
        --line: #323b4a;
        --accent: #ff7657;
      }

      .stage {
        box-shadow: 0 1.5rem 4rem rgb(5 8 13 / 24%);
      }
    }

    @media (max-width: 40rem) {
      header {
        align-items: flex-start;
        flex-direction: column;
        justify-content: center;
        gap: 0.15rem;
      }

      .stage {
        border-radius: 0.75rem;
      }
    }
  </style>
</head>
<body>
  <header>
    <a href="./">HTMS demos</a>
    <span>${title}</span>
  </header>
  <main>
    <section class="stage" aria-label="${title} component">
      <${tagName}></${tagName}>
    </section>
  </main>
  <footer>&lt;${tagName}&gt;&lt;/${tagName}&gt;</footer>
  <script type="module" src="./${base}.js"></script>
</body>
</html>`;
  fs.writeFileSync(previewPath, previewHtml, 'utf8');

  console.log(`✓ Built ${file} → ${base}.js`);
  return { base, tagName, title };
}

function writeGallery(demos: CompiledDemo[]): void {
  const items = demos
    .map(
      ({
        base,
        tagName,
        title,
      }) => `      <li${base === 'counter-component' ? ' class="featured"' : ''}>
        <a href="./${base}.preview.html">
          <span>
            <strong>${title}</strong>
            <code>&lt;${tagName}&gt;</code>
          </span>
          <b>Open demo</b>
        </a>
      </li>`
    )
    .join('\n');

  const gallery = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="${FAVICON}">
  <title>HTMS Component Demos</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #f6f7fb;
      --surface: #ffffff;
      --surface-strong: #172033;
      --ink: #172033;
      --muted: #5d687a;
      --line: #dfe3ec;
      --accent: #d94828;
      --accent-ink: #ffffff;
      font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      min-height: 100dvh;
      margin: 0;
      color: var(--ink);
      background: var(--page);
    }

    .shell {
      width: min(100% - 2rem, 78rem);
      margin: auto;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 4.5rem;
      border-bottom: 1px solid var(--line);
    }

    .wordmark {
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .tagline {
      color: var(--muted);
      font: 0.8125rem/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(18rem, 0.75fr);
      gap: clamp(2rem, 7vw, 7rem);
      align-items: end;
      padding: clamp(4rem, 10vw, 8rem) 0 clamp(3rem, 8vw, 6rem);
    }

    .eyebrow {
      margin: 0 0 1rem;
      color: var(--accent);
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      max-width: 11ch;
      margin: 0;
      font-size: clamp(3.25rem, 8vw, 7.5rem);
      line-height: 0.9;
      letter-spacing: -0.075em;
    }

    .intro {
      max-width: 30rem;
      padding-bottom: 0.5rem;
    }

    .intro p {
      margin: 0 0 1.5rem;
      color: var(--muted);
      font-size: clamp(1rem, 1.6vw, 1.2rem);
      line-height: 1.65;
    }

    .primary-link {
      display: inline-flex;
      min-height: 3rem;
      align-items: center;
      padding: 0.75rem 1.1rem;
      border-radius: 0.75rem;
      color: var(--accent-ink);
      background: var(--accent);
      font-weight: 800;
      text-decoration: none;
      transition:
        transform 180ms ease,
        background-color 180ms ease;
    }

    .primary-link:hover {
      background: color-mix(in srgb, var(--accent) 88%, var(--ink));
      transform: translateY(-2px);
    }

    .primary-link:active {
      transform: translateY(1px);
    }

    .gallery {
      padding: 0 0 6rem;
    }

    .gallery-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    h2 {
      margin: 0;
      font-size: clamp(1.75rem, 4vw, 3rem);
      letter-spacing: -0.045em;
    }

    .count {
      color: var(--muted);
      font: 0.8125rem/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace;
    }

    ul {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.8rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li.featured {
      grid-column: 1 / -1;
    }

    li a {
      display: flex;
      min-height: 8.5rem;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.25rem;
      border: 1px solid var(--line);
      border-radius: 0.9rem;
      color: var(--ink);
      background: var(--surface);
      text-decoration: none;
      box-shadow: 0 0.8rem 2rem rgb(44 53 72 / 5%);
      transition:
        border-color 180ms ease,
        box-shadow 180ms ease,
        transform 180ms ease;
    }

    li.featured a {
      min-height: 11rem;
      color: #f4f6fb;
      background: var(--surface-strong);
    }

    li a:hover {
      border-color: var(--accent);
      box-shadow: 0 1rem 2.5rem rgb(44 53 72 / 10%);
      transform: translateY(-3px);
    }

    li a:active {
      transform: translateY(1px);
    }

    li span {
      display: grid;
      gap: 0.5rem;
    }

    li strong {
      font-size: 1.1rem;
    }

    li code {
      color: var(--muted);
      font-size: 0.75rem;
    }

    li.featured code {
      color: #b9c1d1;
    }

    li b {
      flex: 0 0 auto;
      color: var(--accent);
      font-size: 0.78rem;
    }

    footer {
      padding: 1.5rem 0 2rem;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.8125rem;
    }

    :focus-visible {
      outline: 3px solid color-mix(in srgb, var(--accent) 70%, transparent);
      outline-offset: 4px;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --page: #11151d;
        --surface: #191f2a;
        --surface-strong: #252d3b;
        --ink: #edf0f6;
        --muted: #a7b0c1;
        --line: #323b4a;
        --accent: #ff7657;
        --accent-ink: #18100e;
      }

      li a {
        box-shadow: 0 0.8rem 2rem rgb(5 8 13 / 14%);
      }
    }

    @media (max-width: 48rem) {
      .tagline { display: none; }

      .hero {
        grid-template-columns: 1fr;
        gap: 2rem;
        padding: 4rem 0;
      }

      h1 {
        max-width: 9ch;
        font-size: clamp(3.4rem, 16vw, 5.75rem);
      }

      ul {
        grid-template-columns: 1fr;
      }

      li.featured {
        grid-column: auto;
      }

      li.featured a {
        min-height: 8.5rem;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .primary-link,
      li a {
        transition: none;
      }
    }
  </style>
</head>
<body>
  <header class="shell">
    <span class="wordmark">HTMS</span>
    <span class="tagline">HTML in. JavaScript out.</span>
  </header>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">Component playground</p>
        <h1>Make HTML do things.</h1>
      </div>
      <div class="intro">
        <p>Open a working component, try the interaction, then read the HTML that made it happen.</p>
        <a class="primary-link" href="./counter-component.preview.html">Start with the counter</a>
      </div>
    </section>
    <section class="gallery" aria-labelledby="gallery-heading">
      <div class="gallery-heading">
        <h2 id="gallery-heading">Try every component</h2>
        <span class="count">${demos.length} working examples</span>
      </div>
      <ul>
${items}
      </ul>
    </section>
  </main>
  <footer class="shell">Each page runs the compiled custom element in isolation.</footer>
</body>
</html>`;

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
