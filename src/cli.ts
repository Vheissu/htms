#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  buildPreviewHtml,
  compileFile,
  extractComponentTagName,
  resolveOutputPath,
  CliCompileOptions,
  OutputFormat
} from './cli-helpers';
import { CompilerError, CompilerWarning } from './types';
import { SecurityValidator } from './utils/security';

const DEFAULT_MAX_SIZE = 1048576;
const DEFAULT_PORT = 5173;
const OUTPUT_FORMATS = new Set<OutputFormat>(['esm', 'cjs', 'iife']);
const RELOAD_ENDPOINT = '/__htms_reload';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8'
};

interface CompileCommandOptions {
  output?: string;
  format?: string;
  strict?: boolean;
  maxSize?: string;
  mode?: string;
}

interface DevCommandOptions extends CompileCommandOptions {
  port?: string;
  host?: string;
  tag?: string;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('htms')
    .description('HTML to JavaScript compiler')
    .version('1.0.0');

  program
    .command('compile')
    .description('Compile HTML file to JavaScript')
    .argument('<input>', 'Input HTML file path')
    .option('-o, --output <path>', 'Output file path')
    .option('--format <format>', 'Output format (esm|cjs|iife)', 'esm')
    .option('--strict', 'Enable strict mode', false)
    .option(
      '--max-size <size>',
      'Maximum file size in bytes',
      String(DEFAULT_MAX_SIZE)
    )
    .option('--mode <mode>', 'Compilation mode (only component supported)', 'component')
    .action(async (input: string, options: CompileCommandOptions) => {
      const normalized = normalizeCompileOptions(options);
      if (!normalized.value) {
        printOptionErrors(normalized.errors);
        process.exit(1);
      }

      const result = await compileAndReport(
        input,
        normalized.value,
        '✅ Successfully compiled to'
      );
      if (!result.success) {
        process.exit(1);
      }
    });

  program
    .command('watch')
    .description('Watch HTML file and recompile on changes')
    .argument('<input>', 'Input HTML file path')
    .option('-o, --output <path>', 'Output file path')
    .option('--format <format>', 'Output format (esm|cjs|iife)', 'esm')
    .option('--strict', 'Enable strict mode', false)
    .option(
      '--max-size <size>',
      'Maximum file size in bytes',
      String(DEFAULT_MAX_SIZE)
    )
    .option('--mode <mode>', 'Compilation mode (only component supported)', 'component')
    .action(async (input: string, options: CompileCommandOptions) => {
      const normalized = normalizeCompileOptions(options);
      if (!normalized.value) {
        printOptionErrors(normalized.errors);
        process.exit(1);
      }

      await runWatch(input, normalized.value);
    });

  program
    .command('dev')
    .description('Compile, serve, and live-reload a component in the browser')
    .argument('<input>', 'Input HTML file path')
    .option('-o, --output <path>', 'Output file path')
    .option('--format <format>', 'Output format (esm only for dev)', 'esm')
    .option('--strict', 'Enable strict mode', false)
    .option(
      '--max-size <size>',
      'Maximum file size in bytes',
      String(DEFAULT_MAX_SIZE)
    )
    .option('-p, --port <port>', 'Dev server port', String(DEFAULT_PORT))
    .option('--host <host>', 'Dev server host', '127.0.0.1')
    .option('--tag <tag>', 'Preview component tag name (override auto-detection)')
    .option('--mode <mode>', 'Compilation mode (only component supported)', 'component')
    .action(async (input: string, options: DevCommandOptions) => {
      const normalized = normalizeCompileOptions(options);
      if (!normalized.value) {
        printOptionErrors(normalized.errors);
        process.exit(1);
      }

      if (normalized.value.format !== 'esm') {
        console.error('Error: dev server requires --format esm for browser modules.');
        process.exit(1);
      }

      const port = parsePort(options.port);
      if (port === null) {
        console.error('Error: invalid --port value.');
        process.exit(1);
      }

      const host = options.host?.trim() || '127.0.0.1';
      await runDevServer(input, normalized.value, {
        port,
        host,
        tag: options.tag
      });
    });

  program
    .command('validate')
    .description('Validate HTML file without compilation')
    .argument('<input>', 'Input HTML file path')
    .action(async (input: string) => {
      try {
        const validationErrors = SecurityValidator.validateFilePath(input);
        const extensionErrors = SecurityValidator.validateFileExtension(input, [
          'html',
          'htm'
        ]);

        if (validationErrors.length > 0 || extensionErrors.length > 0) {
          console.error('❌ Validation failed:');
          [...validationErrors, ...extensionErrors].forEach(error => {
            console.error(`  - ${error.message}`);
          });
          process.exit(1);
        }

        const htmlContent = await fs.promises.readFile(input, 'utf8');
        const contentErrors = SecurityValidator.validateContent(htmlContent);

        if (contentErrors.length > 0) {
          console.error('❌ Security validation failed:');
          contentErrors.forEach(error => {
            console.error(`  - ${error.message}`);
          });
          process.exit(1);
        }

        console.log('✅ File validation passed');
      } catch (error) {
        console.error('❌ Validation error:', error);
        process.exit(1);
      }
    });

  return program;
}

function normalizeCompileOptions(options: CompileCommandOptions): {
  value?: CliCompileOptions;
  errors: string[];
} {
  const errors: string[] = [];
  const format = (options.format ?? 'esm').toLowerCase();
  if (!OUTPUT_FORMATS.has(format as OutputFormat)) {
    errors.push(`Invalid --format. Use one of: ${[...OUTPUT_FORMATS].join(', ')}`);
  }

  const maxSize = parseMaxSize(options.maxSize);
  if (maxSize === null) {
    errors.push('Invalid --max-size. Provide a positive number in bytes.');
  }

  const mode = (options.mode ?? 'component').toLowerCase();
  if (mode !== 'component') {
    errors.push('Only component mode is supported.');
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    value: {
      outputPath: options.output,
      format: format as OutputFormat,
      strict: Boolean(options.strict),
      maxSize: maxSize ?? DEFAULT_MAX_SIZE,
      mode: 'component'
    },
    errors
  };
}

function parseMaxSize(value: string | undefined): number | null {
  if (!value) return DEFAULT_MAX_SIZE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function parsePort(value: string | undefined): number | null {
  const parsed = Number(value ?? DEFAULT_PORT);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return Math.floor(parsed);
}

function printOptionErrors(errors: string[]): void {
  if (errors.length === 0) return;
  console.error('Error: invalid options');
  errors.forEach(error => console.error(`  - ${error}`));
}

function printCompilationErrors(errors: CompilerError[]): void {
  if (errors.length === 0) return;
  console.error('Compilation failed:');
  errors.forEach(error => {
    console.error(`  ${error.type}: ${error.message}`);
    if (error.line) {
      const column = error.column ? `:${error.column}` : '';
      console.error(`    at line ${error.line}${column}`);
    }
  });
}

function printWarnings(warnings: CompilerWarning[]): void {
  if (warnings.length === 0) return;
  console.log('⚠️  Warnings:');
  warnings.forEach(warning => {
    console.log(`  - ${warning.message}`);
    if (warning.line) {
      const column = warning.column ? `:${warning.column}` : '';
      console.log(`    at line ${warning.line}${column}`);
    }
  });
}

async function compileAndReport(
  input: string,
  options: CliCompileOptions,
  successLabel: string
): Promise<{ success: boolean; outputPath?: string }> {
  const result = await compileFile(input, options);
  if (result.success && result.outputPath) {
    console.log(`${successLabel} ${result.outputPath}`);
  } else {
    printCompilationErrors(result.errors);
  }
  printWarnings(result.warnings);
  return { success: result.success, outputPath: result.outputPath };
}

function debounce(fn: () => void, delay: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
}

async function runWatch(input: string, options: CliCompileOptions): Promise<void> {
  if (!fs.existsSync(input)) {
    console.error(`Error: Cannot read file: ${input}`);
    process.exit(1);
  }

  await compileAndReport(input, options, '✅ Successfully compiled to');

  console.log(`👀 Watching ${input}`);
  const schedule = debounce(() => {
    void compileAndReport(input, options, '🔁 Recompiled to');
  }, 100);

  const watcher = fs.watch(input, { persistent: true }, () => schedule());
  const shutdown = () => {
    watcher.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
}

function isWithinRoot(rootDir: string, filePath: string): boolean {
  const relative = path.relative(rootDir, filePath);
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function toUrlPath(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath).split(path.sep).join('/');
  return `/${relative}`;
}

function resolveRequestPath(rootDir: string, urlPath: string): string | null {
  let decoded = '';
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const normalized = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(rootDir, normalized);
  return isWithinRoot(rootDir, resolved) ? resolved : null;
}

function sendText(
  res: http.ServerResponse,
  status: number,
  body: string,
  type = 'text/plain; charset=utf-8'
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.end(body);
}

async function runDevServer(
  input: string,
  options: CliCompileOptions,
  dev: { port: number; host: string; tag?: string }
): Promise<void> {
  const resolvedInput = path.resolve(input);
  const rootDir = path.dirname(resolvedInput);
  const outputPath = resolveOutputPath(resolvedInput, options.outputPath);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`Error: Cannot read file: ${resolvedInput}`);
    process.exit(1);
  }

  if (!isWithinRoot(rootDir, outputPath)) {
    console.error('Error: --output must be within the input directory for dev.');
    process.exit(1);
  }

  const scriptPath = toUrlPath(rootDir, outputPath);
  let previewTag = dev.tag?.trim().toLowerCase() || '';
  let warnedMultiple = false;

  const initialTag = await inferTagName(resolvedInput);
  previewTag = previewTag || initialTag;

  const clients = new Set<http.ServerResponse>();

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      sendText(res, 400, 'Bad Request');
      return;
    }

    const url = new URL(req.url, `http://${dev.host}`);
    const urlPath = url.pathname;

    if (urlPath === RELOAD_ENDPOINT) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (urlPath === '/' || urlPath === '/index.html') {
      const html = buildPreviewHtml({
        tagName: previewTag || 'htms-preview',
        scriptPath,
        enableReload: true,
        reloadEndpoint: RELOAD_ENDPOINT
      });
      sendText(res, 200, html, 'text/html; charset=utf-8');
      return;
    }

    const fsPath = resolveRequestPath(rootDir, urlPath);
    if (!fsPath) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(fsPath);
    } catch {
      sendText(res, 404, 'Not Found');
      return;
    }

    let filePath = fsPath;
    if (stat.isDirectory()) {
      filePath = path.join(fsPath, 'index.html');
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        sendText(res, 404, 'Not Found');
        return;
      }
    }

    if (!stat.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const data = await fs.promises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });

  const compileAndReload = async (label: string): Promise<void> => {
    const result = await compileFile(resolvedInput, {
      ...options,
      outputPath
    });

    if (!result.success) {
      printCompilationErrors(result.errors);
      printWarnings(result.warnings);
      return;
    }

    if (result.components && result.components.length > 0) {
      if (!dev.tag) {
        if (result.components.length > 1 && !warnedMultiple) {
          const names = result.components.map(c => c.tagName).join(', ');
          console.log(`ℹ️  Multiple components found: ${names}`);
          console.log(`   Previewing "${result.components[0].tagName}". Use --tag to pick.`);
          warnedMultiple = true;
        }
        previewTag = result.components[0].tagName;
      }
    }

    console.log(`${label} ${outputPath}`);
    printWarnings(result.warnings);

    clients.forEach(client => {
      client.write('data: reload\n\n');
    });
  };

  await compileAndReload('✅ Successfully compiled to');

  server.listen(dev.port, dev.host, () => {
    const base = `http://${dev.host}:${dev.port}`;
    console.log(`🚀 HTMS dev server running at ${base}/`);
    console.log(`   Previewing <${previewTag || 'htms-preview'}>`);
    console.log(`   Serving ${rootDir}`);
  });

  const schedule = debounce(() => {
    void compileAndReload('🔁 Recompiled to');
  }, 100);

  const watcher = fs.watch(resolvedInput, { persistent: true }, () => schedule());
  const shutdown = () => {
    watcher.close();
    clients.forEach(client => client.end());
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
}

async function inferTagName(inputPath: string): Promise<string> {
  try {
    const html = await fs.promises.readFile(inputPath, 'utf8');
    return extractComponentTagName(html) ?? 'htms-preview';
  } catch {
    return 'htms-preview';
  }
}

export const program = createProgram();

if (require.main === module) {
  if (process.argv.length < 3) {
    program.help();
  }
  program.parse();
}
