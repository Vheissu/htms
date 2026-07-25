#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {
  buildPreviewHtml,
  compileFile,
  createStarterComponent,
  extractComponentTagName,
  resolveOutputPath,
  validateFile,
  CliCompileOptions,
  OutputFormat,
  PreviewDiagnostic,
} from './cli-helpers';
import { CompilerError, CompilerWarning } from './types';
import {
  renderToString,
  ServerRenderError,
  ServerRenderOptions,
} from './server-renderer';
import { SecurityValidator } from './utils/security';

const DEFAULT_MAX_SIZE = 1048576;
const DEFAULT_PORT = 5173;
const OUTPUT_FORMATS = new Set<OutputFormat>(['esm', 'cjs', 'iife']);
const RELOAD_ENDPOINT = '/__htms_reload';

const MIME = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.cjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

interface CompileCommandOptions {
  output?: string;
  format?: string;
  strict?: boolean;
  maxSize?: string;
  mode?: string;
  declarations?: boolean;
}

interface DevCommandOptions extends CompileCommandOptions {
  port?: string;
  host?: string;
  tag?: string;
}

interface RenderCommandOptions {
  output?: string;
  tag?: string;
  id?: string;
  props?: string;
  attributes?: string;
  children?: string;
  manifest?: boolean;
  strict?: boolean;
}

interface CreateCommandOptions {
  output?: string;
  force?: boolean;
}

interface DiagnosticContext {
  filePath?: string;
  source?: string;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('htms')
    .description('Write reactive web components with HTML')
    .version('1.0.0');

  program
    .command('create')
    .alias('new')
    .description('Create an interactive HTMS starter component')
    .argument('<name>', 'Custom element name, for example click-counter')
    .option('-o, --output <path>', 'Starter HTML file path')
    .option('--force', 'Replace an existing starter file', false)
    .action(async (name: string, options: CreateCommandOptions) => {
      const result = await createStarterComponent(name, {
        outputPath: options.output,
        force: options.force,
      });
      if (!result.success || !result.outputPath || !result.tagName) {
        printCompilationErrors(result.errors);
        process.exit(1);
      }

      const outputPath = displayPath(result.outputPath);
      console.log(`✨ Created <${result.tagName}> in ${outputPath}`);
      console.log(`   Next: htms dev ${JSON.stringify(outputPath)}`);
    });

  program
    .command('compile')
    .description('Compile HTML file to JavaScript')
    .argument('<input>', 'Input HTML file path')
    .option('-o, --output <path>', 'Output file path')
    .option('--format <format>', 'Output format (esm|cjs|iife)', 'esm')
    .option('--strict', 'Enable strict mode', false)
    .option('--no-declarations', 'Do not write a TypeScript declaration file')
    .option(
      '--max-size <size>',
      'Maximum file size in bytes',
      String(DEFAULT_MAX_SIZE)
    )
    .option(
      '--mode <mode>',
      'Compilation mode (only component supported)',
      'component'
    )
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
    .option('--no-declarations', 'Do not write a TypeScript declaration file')
    .option(
      '--max-size <size>',
      'Maximum file size in bytes',
      String(DEFAULT_MAX_SIZE)
    )
    .option(
      '--mode <mode>',
      'Compilation mode (only component supported)',
      'component'
    )
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
    .option('--no-declarations', 'Do not write a TypeScript declaration file')
    .option(
      '--max-size <size>',
      'Maximum file size in bytes',
      String(DEFAULT_MAX_SIZE)
    )
    .option('-p, --port <port>', 'Dev server port', String(DEFAULT_PORT))
    .option('--host <host>', 'Dev server host', '127.0.0.1')
    .option(
      '--tag <tag>',
      'Preview component tag name (override auto-detection)'
    )
    .option(
      '--mode <mode>',
      'Compilation mode (only component supported)',
      'component'
    )
    .action(async (input: string, options: DevCommandOptions) => {
      const normalized = normalizeCompileOptions(options);
      if (!normalized.value) {
        printOptionErrors(normalized.errors);
        process.exit(1);
      }

      if (normalized.value.format !== 'esm') {
        console.error(
          'Error: dev server requires --format esm for browser modules.'
        );
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
        tag: options.tag,
      });
    });

  program
    .command('render')
    .description('Server-render a component to declarative shadow DOM')
    .argument('<input>', 'Input HTML file path')
    .option('-o, --output <path>', 'Output HTML file path')
    .option('--tag <tag>', 'Component tag to render when the file has several')
    .option('--id <id>', 'Hydration id for this rendered instance', '0')
    .option('--props <json>', 'Component properties as a JSON object', '{}')
    .option('--attributes <json>', 'Host attributes as a JSON object', '{}')
    .option('--children <html>', 'Light DOM or slot content')
    .option('--no-manifest', 'Omit the hydration manifest script')
    .option('--no-strict', 'Allow recoverable compiler errors')
    .action(async (input: string, options: RenderCommandOptions) => {
      const props = parseJsonRecord(options.props, '--props');
      const attributes = parseRenderAttributes(options.attributes);
      if (!props.value || !attributes.value) {
        printOptionErrors([...props.errors, ...attributes.errors]);
        process.exit(1);
      }

      const result = await renderFile(input, {
        outputPath: options.output,
        tagName: options.tag,
        hydrationId: options.id,
        props: props.value,
        attributes: attributes.value,
        children: options.children,
        includeManifestScript: options.manifest ?? true,
        strict: options.strict ?? true,
      });
      if (!result.success) {
        process.exit(1);
      }
      console.log(`✅ Server-rendered to ${result.outputPath}`);
    });

  program
    .command('validate')
    .description('Check an HTMS file without writing compiled output')
    .argument('<input>', 'Input HTML file path')
    .action(async (input: string) => {
      const result = await validateFile(input, DEFAULT_MAX_SIZE);
      const context = { filePath: input, source: result.source };
      if (!result.success) {
        printCompilationErrors(result.errors, context);
        printWarnings(result.warnings, context);
        process.exit(1);
      }

      printWarnings(result.warnings, context);
      const componentCount = result.components?.length ?? 0;
      const noun = componentCount === 1 ? 'component' : 'components';
      console.log(`✅ Valid HTMS: ${componentCount} ${noun}`);
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
    errors.push(
      `Invalid --format. Use one of: ${[...OUTPUT_FORMATS].join(', ')}`
    );
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
      mode: 'component',
      declarations: options.declarations ?? true,
    },
    errors,
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

function parseJsonRecord(
  value: string | undefined,
  optionName: string
): { value?: Record<string, unknown>; errors: string[] } {
  try {
    const parsed = JSON.parse(value ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        errors: [`${optionName} must be a JSON object.`],
      };
    }
    return { value: parsed as Record<string, unknown>, errors: [] };
  } catch (error) {
    return {
      errors: [`${optionName} contains invalid JSON: ${String(error)}`],
    };
  }
}

function parseRenderAttributes(value: string | undefined): {
  value?: NonNullable<ServerRenderOptions['attributes']>;
  errors: string[];
} {
  const parsed = parseJsonRecord(value, '--attributes');
  if (!parsed.value) {
    return { errors: parsed.errors };
  }
  const attributeEntries: Array<[string, string | number | boolean | null]> =
    [];
  const errors: string[] = [];
  for (const [name, attributeValue] of Object.entries(parsed.value)) {
    if (
      attributeValue !== null &&
      typeof attributeValue !== 'string' &&
      typeof attributeValue !== 'number' &&
      typeof attributeValue !== 'boolean'
    ) {
      errors.push(
        `--attributes value for "${name}" must be a string, number, boolean, or null.`
      );
      continue;
    }
    attributeEntries.push([name, attributeValue]);
  }
  return errors.length > 0
    ? { errors }
    : { value: Object.fromEntries(attributeEntries), errors: [] };
}

async function renderFile(
  input: string,
  options: ServerRenderOptions & { outputPath?: string }
): Promise<{ success: boolean; outputPath?: string }> {
  const inputPath = path.resolve(input);
  const pathErrors = [
    ...SecurityValidator.validateFilePath(inputPath),
    ...SecurityValidator.validateFileExtension(inputPath, ['html', 'htm']),
  ];
  if (pathErrors.length > 0) {
    printCompilationErrors(pathErrors, { filePath: inputPath });
    return { success: false };
  }

  let source: string;
  try {
    const stats = await fs.promises.stat(inputPath);
    if (stats.size > DEFAULT_MAX_SIZE) {
      console.error(
        `Server rendering failed: file exceeds ${DEFAULT_MAX_SIZE} bytes.`
      );
      return { success: false };
    }
    source = await fs.promises.readFile(inputPath, 'utf8');
  } catch (error) {
    console.error(`Server rendering failed: ${String(error)}`);
    return { success: false };
  }

  const outputPath = path.resolve(
    options.outputPath ??
      path.join(
        path.dirname(inputPath),
        `${path.basename(inputPath, path.extname(inputPath))}.ssr.html`
      )
  );
  const outputErrors = SecurityValidator.validateFilePath(outputPath);
  if (outputErrors.length > 0) {
    printCompilationErrors(outputErrors, { filePath: outputPath });
    return { success: false };
  }

  try {
    const rendered = renderToString(source, options);
    await fs.promises.writeFile(outputPath, rendered.html, 'utf8');
    return { success: true, outputPath };
  } catch (error) {
    if (error instanceof ServerRenderError) {
      console.error(`Server rendering failed: ${error.message}`);
      printCompilationErrors(error.errors, {
        filePath: inputPath,
        source,
      });
    } else {
      console.error(`Server rendering failed: ${String(error)}`);
    }
    return { success: false };
  }
}

function printOptionErrors(errors: string[]): void {
  if (errors.length === 0) return;
  console.error('Error: invalid options');
  errors.forEach((error) => console.error(`  - ${error}`));
}

function displayPath(filePath: string): string {
  const relative = path.relative(process.cwd(), path.resolve(filePath));
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return filePath;
}

function buildCodeFrame(source: string, line: number, column = 1): string[] {
  const sourceLines = source.split(/\r?\n/);
  if (line < 1 || line > sourceLines.length) {
    return [];
  }

  const start = Math.max(1, line - 1);
  const end = Math.min(sourceLines.length, line + 1);
  const width = String(end).length;
  const frame = sourceLines.slice(start - 1, end).map((sourceLine, offset) => {
    const currentLine = start + offset;
    const marker = currentLine === line ? '>' : ' ';
    return `  ${marker} ${String(currentLine).padStart(width)} | ${sourceLine}`;
  });

  const selectedLine = sourceLines.find((_, index) => index === line - 1) ?? '';
  const prefix = selectedLine
    .slice(0, Math.max(0, column - 1))
    .replace(/\t/g, '  ');
  frame.splice(line - start + 1, 0, `      ${' '.repeat(width)} | ${prefix}^`);
  return frame;
}

function printCompilationErrors(
  errors: CompilerError[],
  context: DiagnosticContext = {}
): void {
  if (errors.length === 0) return;
  console.error(
    `❌ Compilation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`
  );
  errors.forEach((error) => {
    const hasInputLocation = error.line && error.source !== 'generated';
    if (context.filePath) {
      const filePath = displayPath(context.filePath);
      const column = error.column ? `:${error.column}` : '';
      const line = error.line ? `:${error.line}${column}` : '';
      console.error(`\n  ${filePath}${line}`);
    }
    console.error(`  ${error.type}: ${error.message}`);
    if (hasInputLocation && context.source) {
      buildCodeFrame(context.source, error.line ?? 1, error.column).forEach(
        (line) => console.error(line)
      );
    } else if (error.line) {
      const column = error.column ? `:${error.column}` : '';
      const location =
        error.source === 'generated'
          ? `generated JavaScript ${error.line}${column}`
          : `line ${error.line}${column}`;
      console.error(`  at ${location}`);
    }
    if (error.hint) {
      console.error(`  help: ${error.hint}`);
    }
  });
}

function printWarnings(
  warnings: CompilerWarning[],
  context: DiagnosticContext = {}
): void {
  if (warnings.length === 0) return;
  console.log('⚠️  Warnings:');
  warnings.forEach((warning) => {
    if (context.filePath) {
      const column = warning.column ? `:${warning.column}` : '';
      const line = warning.line ? `:${warning.line}${column}` : '';
      console.log(`\n  ${displayPath(context.filePath)}${line}`);
    }
    console.log(`  ${warning.message}`);
    if (warning.line && warning.source !== 'generated' && context.source) {
      buildCodeFrame(context.source, warning.line, warning.column).forEach(
        (line) => console.log(line)
      );
    }
    if (warning.hint) {
      console.log(`  help: ${warning.hint}`);
    }
  });
}

function toPreviewDiagnostics(
  errors: CompilerError[],
  warnings: CompilerWarning[]
): PreviewDiagnostic[] {
  return [
    ...errors.map((error) => ({
      level: 'error' as const,
      type: error.type,
      message: error.message,
      line: error.source === 'generated' ? undefined : error.line,
      column: error.source === 'generated' ? undefined : error.column,
      hint: error.hint,
    })),
    ...warnings.map((warning) => ({
      level: 'warning' as const,
      message: warning.message,
      line: warning.source === 'generated' ? undefined : warning.line,
      column: warning.source === 'generated' ? undefined : warning.column,
      hint: warning.hint,
    })),
  ];
}

function sendDevEvent(
  client: http.ServerResponse,
  event: 'compiled' | 'diagnostics',
  data: string
): void {
  client.write(`event: ${event}\ndata: ${data}\n\n`);
}

async function compileAndReport(
  input: string,
  options: CliCompileOptions,
  successLabel: string
): Promise<{ success: boolean; outputPath?: string }> {
  const result = await compileFile(input, options);
  const context = { filePath: input, source: result.source };
  if (result.success && result.outputPath) {
    console.log(`${successLabel} ${result.outputPath}`);
  } else {
    printCompilationErrors(result.errors, context);
  }
  printWarnings(result.warnings, context);
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

async function runWatch(
  input: string,
  options: CliCompileOptions
): Promise<void> {
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
  const shutdown = (): void => {
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
  let decoded: string;
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
    Expires: '0',
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
    console.error(
      'Error: --output must be within the input directory for dev.'
    );
    process.exit(1);
  }

  const scriptPath = toUrlPath(rootDir, outputPath);
  let previewTag = dev.tag?.trim().toLowerCase() || '';
  let warnedMultiple = false;
  let lastDiagnostics: PreviewDiagnostic[] = [];

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
        Connection: 'keep-alive',
      });
      res.write('\n');
      clients.add(res);
      if (lastDiagnostics.length > 0) {
        sendDevEvent(res, 'diagnostics', JSON.stringify(lastDiagnostics));
      }
      req.on('close', () => clients.delete(res));
      return;
    }

    if (urlPath === '/' || urlPath === '/index.html') {
      const html = buildPreviewHtml({
        tagName: previewTag || 'htms-preview',
        scriptPath,
        enableReload: true,
        reloadEndpoint: RELOAD_ENDPOINT,
        diagnostics: lastDiagnostics,
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
    const type = MIME.get(ext) || 'application/octet-stream';
    const data = await fs.promises.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });

  const compileAndReload = async (label: string): Promise<void> => {
    const result = await compileFile(resolvedInput, {
      ...options,
      outputPath,
    });

    if (!result.success) {
      const context = {
        filePath: resolvedInput,
        source: result.source,
      };
      printCompilationErrors(result.errors, context);
      printWarnings(result.warnings, context);
      lastDiagnostics = toPreviewDiagnostics(result.errors, result.warnings);
      const payload = JSON.stringify(lastDiagnostics);
      clients.forEach((client) => sendDevEvent(client, 'diagnostics', payload));
      return;
    }

    lastDiagnostics = toPreviewDiagnostics([], result.warnings);
    if (result.components && result.components.length > 0) {
      if (!dev.tag) {
        if (result.components.length > 1 && !warnedMultiple) {
          const names = result.components.map((c) => c.tagName).join(', ');
          console.log(`ℹ️  Multiple components found: ${names}`);
          console.log(
            `   Previewing "${result.components[0].tagName}". Use --tag to pick.`
          );
          warnedMultiple = true;
        }
        previewTag = result.components[0].tagName;
      }
    }

    console.log(`${label} ${outputPath}`);
    printWarnings(result.warnings, {
      filePath: resolvedInput,
      source: result.source,
    });

    clients.forEach((client) => {
      sendDevEvent(client, 'compiled', 'reload');
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

  const watcher = fs.watch(resolvedInput, { persistent: true }, () =>
    schedule()
  );
  const shutdown = (): void => {
    watcher.close();
    clients.forEach((client) => client.end());
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
