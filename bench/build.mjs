// Builds every benchmark app with the same Vite production pipeline, so
// bundle sizes and parse costs are compared under one minifier.
//
//   node build.mjs            build all apps into dist/
//   node build.mjs --skip-compiler   reuse the existing ../dist compiler

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import solid from 'vite-plugin-solid';
import vue from '@vitejs/plugin-vue';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const work = path.join(here, 'dist', '.work');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--skip-compiler')) {
  console.log('Building the HTMS compiler…');
  execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });
}
const { parseHTML } = require(path.join(repo, 'dist', 'parser.js'));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

function compileHtms(renderer, outDir) {
  const source = fs.readFileSync(path.join(here, 'apps/htms/app.html'), 'utf8');
  const result = parseHTML(source, { mode: 'component', renderer });
  if (!result.success) {
    throw new Error(`HTMS compile failed: ${JSON.stringify(result.errors)}`);
  }
  const usesBlocks = result.code.includes('__htmsList(');
  if ((renderer === 'auto') !== usesBlocks) {
    throw new Error(`Expected the ${renderer} renderer for the HTMS app`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'app.js'), result.code);
  fs.writeFileSync(path.join(outDir, 'main.js'), "import './app.js';\n");
  return path.join(outDir, 'main.js');
}

const apps = [
  {
    name: 'vanilla',
    label: 'Vanilla JS',
    entry: path.join(here, 'apps/vanilla/Main.js'),
    html: path.join(here, 'apps/vanilla/index.html'),
  },
  {
    name: 'htms',
    label: 'HTMS',
    entry: compileHtms('auto', path.join(work, 'htms')),
    html: path.join(here, 'apps/htms/index.html'),
  },
  {
    name: 'svelte',
    label: 'Svelte 5',
    entry: path.join(here, 'apps/svelte/main.js'),
    html: path.join(here, 'apps/svelte/index.html'),
    plugins: [svelte()],
  },
  {
    name: 'solid',
    label: 'Solid',
    entry: path.join(here, 'apps/solid/main.jsx'),
    html: path.join(here, 'apps/solid/index.html'),
    plugins: [solid()],
  },
  {
    name: 'vue',
    label: 'Vue',
    entry: path.join(here, 'apps/vue/main.js'),
    html: path.join(here, 'apps/vue/index.html'),
    plugins: [vue()],
  },
  {
    name: 'react',
    label: 'React',
    entry: path.join(here, 'apps/react/main.jsx'),
    html: path.join(here, 'apps/react/index.html'),
    oxc: { jsx: { runtime: 'automatic' } },
  },
  {
    name: 'htms-legacy',
    label: 'HTMS (reconciler)',
    entry: compileHtms('legacy', path.join(work, 'htms-legacy')),
    html: path.join(here, 'apps/htms/index.html'),
  },
];

const sizes = {};
for (const app of apps) {
  const outDir = path.join(dist, app.name);
  await build({
    configFile: false,
    logLevel: 'warn',
    root: here,
    plugins: app.plugins ?? [],
    ...(app.oxc ? { oxc: app.oxc } : {}),
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: app.entry,
        output: { entryFileNames: 'main.js', format: 'es' },
      },
    },
  });
  fs.copyFileSync(app.html, path.join(outDir, 'index.html'));
  const code = fs.readFileSync(path.join(outDir, 'main.js'));
  sizes[app.name] = {
    label: app.label,
    minified: code.length,
    gzip: zlib.gzipSync(code, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(code, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
  console.log(
    `${app.label.padEnd(18)} ${String(sizes[app.name].minified).padStart(7)} B min  ${String(sizes[app.name].gzip).padStart(6)} B gzip`
  );
}

// The benchmark's default stylesheet: Bootstrap 3.3.6 plus main.css.
const css = path.join(dist, 'css');
fs.mkdirSync(path.join(css, 'bootstrap/dist/css'), { recursive: true });
fs.cpSync(
  path.join(here, 'node_modules/bootstrap/dist/fonts'),
  path.join(css, 'bootstrap/dist/fonts'),
  { recursive: true }
);
fs.copyFileSync(
  path.join(here, 'node_modules/bootstrap/dist/css/bootstrap.min.css'),
  path.join(css, 'bootstrap/dist/css/bootstrap.min.css')
);
fs.copyFileSync(path.join(here, 'css/main.css'), path.join(css, 'main.css'));
fs.writeFileSync(
  path.join(css, 'currentStyle.css'),
  '@import url("/css/bootstrap/dist/css/bootstrap.min.css");\n@import url("/css/main.css");\n'
);

fs.rmSync(work, { recursive: true, force: true });
fs.writeFileSync(path.join(dist, 'sizes.json'), JSON.stringify(sizes, null, 2));
console.log('Built benchmark apps into bench/dist');
