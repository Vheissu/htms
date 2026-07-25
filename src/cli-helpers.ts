import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { generateComponentDeclarations } from './component/declarations';
import { parseHTML } from './parser';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';
import {
  ComponentArtifact,
  CompilerError,
  CompilerWarning,
  ParseOptions,
} from './types';

export type OutputFormat = 'esm' | 'cjs' | 'iife';

export interface CliCompileOptions {
  outputPath?: string;
  format: OutputFormat;
  strict: boolean;
  maxSize: number;
  mode?: 'component';
  declarations?: boolean;
}

export interface CompileOutcome {
  success: boolean;
  outputPath?: string;
  declarationPath?: string;
  source?: string;
  code?: string;
  declarations?: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
  components?: ComponentArtifact[];
}

export interface StarterOutcome {
  success: boolean;
  outputPath?: string;
  tagName?: string;
  source?: string;
  errors: CompilerError[];
}

export interface ValidationOutcome {
  success: boolean;
  source?: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
  components?: ComponentArtifact[];
}

interface SourceFileOutcome {
  source?: string;
  errors: CompilerError[];
}

const VALID_CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/;

export function resolveOutputPath(
  inputPath: string,
  outputPath?: string
): string {
  if (outputPath) return outputPath;
  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(path.dirname(inputPath), `${baseName}.js`);
}

export function resolveDeclarationPath(outputPath: string): string {
  const extension = path.extname(outputPath);
  const basePath = extension
    ? outputPath.slice(0, -extension.length)
    : outputPath;
  return `${basePath}.d.ts`;
}

async function readSourceFile(
  inputPath: string,
  maxSize: number
): Promise<SourceFileOutcome> {
  const validationErrors = SecurityValidator.validateFilePath(inputPath);
  if (validationErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid input file path', {
      input: inputPath,
      errors: validationErrors,
    });
    return { errors: validationErrors };
  }

  const extensionErrors = SecurityValidator.validateFileExtension(inputPath, [
    'html',
    'htm',
  ]);
  if (extensionErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid file extension', {
      input: inputPath,
      errors: extensionErrors,
    });
    return { errors: extensionErrors };
  }

  try {
    await fs.access(inputPath, fsSync.constants.R_OK);
  } catch {
    const error: CompilerError = {
      type: 'validation',
      message: `Cannot read file: ${inputPath}`,
      hint: 'Check that the path exists and that the file is readable.',
    };
    CompilerLogger.logValidationError('File not accessible', {
      input: inputPath,
    });
    return { errors: [error] };
  }

  let stats: fsSync.Stats;
  try {
    stats = await fs.stat(inputPath);
  } catch (error) {
    const fileError: CompilerError = {
      type: 'runtime',
      message: `Failed to read file stats: ${String(error)}`,
    };
    CompilerLogger.logCompilerError('File stat failed', {
      input: inputPath,
      error,
    });
    return { errors: [fileError] };
  }

  if (stats.size > maxSize) {
    const error: CompilerError = {
      type: 'validation',
      message: `File too large. Maximum size: ${maxSize} bytes`,
      hint: 'Split large component files or raise --max-size explicitly.',
    };
    CompilerLogger.logValidationError('File too large', {
      input: inputPath,
      size: stats.size,
      maxSize,
    });
    return { errors: [error] };
  }

  let source: string;
  try {
    source = await fs.readFile(inputPath, 'utf8');
  } catch (error) {
    const fileError: CompilerError = {
      type: 'runtime',
      message: `Failed to read file: ${String(error)}`,
    };
    CompilerLogger.logCompilerError('File read failed', {
      input: inputPath,
      error,
    });
    return { errors: [fileError] };
  }

  const contentErrors = SecurityValidator.validateContent(source);
  if (contentErrors.length > 0) {
    CompilerLogger.logSecurityIssue('Dangerous content detected', {
      input: inputPath,
      errors: contentErrors,
    });
    return { source, errors: contentErrors };
  }

  return { source, errors: [] };
}

export async function compileFile(
  inputPath: string,
  options: CliCompileOptions
): Promise<CompileOutcome> {
  const startTime = Date.now();
  const warnings: CompilerWarning[] = [];
  const errors: CompilerError[] = [];
  const mode = options.mode ?? 'component';

  if (mode !== 'component') {
    errors.push({
      type: 'validation',
      message: 'Only component mode is supported.',
    });
    return { success: false, errors, warnings };
  }

  const input = await readSourceFile(inputPath, options.maxSize);
  if (input.source === undefined) {
    return { success: false, errors: input.errors, warnings };
  }
  if (input.errors.length > 0) {
    return {
      success: false,
      source: input.source,
      errors: input.errors,
      warnings,
    };
  }
  const htmlContent = input.source;

  const parseOptions: ParseOptions = {
    maxFileSize: options.maxSize,
    strictMode: options.strict,
    outputFormat: options.format,
    mode: 'component',
  };

  CompilerLogger.logInfo('Starting compilation', {
    input: inputPath,
    options: parseOptions,
  });

  const result = parseHTML(htmlContent, parseOptions);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  if (!result.success || !result.code) {
    CompilerLogger.logCompilerError('Compilation failed', {
      input: inputPath,
      errors: result.errors,
    });
    return {
      success: false,
      source: htmlContent,
      errors,
      warnings,
      components: result.components,
    };
  }

  const outputPath = resolveOutputPath(inputPath, options.outputPath);
  const outputValidationErrors = SecurityValidator.validateFilePath(outputPath);
  if (outputValidationErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid output file path', {
      outputPath,
      errors: outputValidationErrors,
    });
    return { success: false, errors: outputValidationErrors, warnings };
  }

  const shouldWriteDeclarations = options.declarations ?? true;
  const declarationPath = shouldWriteDeclarations
    ? resolveDeclarationPath(outputPath)
    : undefined;
  const declarations = declarationPath
    ? generateComponentDeclarations(result.components ?? [])
    : undefined;
  const declarationValidationErrors = declarationPath
    ? SecurityValidator.validateFilePath(declarationPath)
    : [];
  if (declarationValidationErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid declaration output path', {
      declarationPath,
      errors: declarationValidationErrors,
    });
    return { success: false, errors: declarationValidationErrors, warnings };
  }

  try {
    const writes: Promise<void>[] = [fs.writeFile(outputPath, result.code)];
    if (declarationPath && declarations !== undefined) {
      writes.push(fs.writeFile(declarationPath, declarations));
    }
    await Promise.all(writes);
  } catch (error) {
    const err: CompilerError = {
      type: 'runtime',
      message: `Failed to write output: ${String(error)}`,
    };
    CompilerLogger.logCompilerError('Output write failed', {
      outputPath,
      error,
    });
    return { success: false, errors: [err], warnings };
  }

  const duration = Date.now() - startTime;
  CompilerLogger.logPerformanceMetric('compilation', duration, {
    input: inputPath,
    output: outputPath,
    codeLength: result.code.length,
  });

  return {
    success: true,
    outputPath,
    declarationPath,
    source: htmlContent,
    code: result.code,
    declarations,
    errors: [],
    warnings,
    components: result.components,
  };
}

export async function validateFile(
  inputPath: string,
  maxSize: number
): Promise<ValidationOutcome> {
  const input = await readSourceFile(inputPath, maxSize);
  if (input.source === undefined || input.errors.length > 0) {
    return {
      success: false,
      source: input.source,
      errors: input.errors,
      warnings: [],
    };
  }

  const result = parseHTML(input.source, {
    maxFileSize: maxSize,
    strictMode: true,
    outputFormat: 'esm',
    mode: 'component',
  });

  return {
    success: result.success,
    source: input.source,
    errors: result.errors,
    warnings: result.warnings,
    components: result.components,
  };
}

export function buildStarterComponent(tagName: string): string {
  return `<component name="${tagName}">
  <var name="count" value="0" mutable="true"></var>

  <style>
    :host {
      display: inline-block;
      font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
    }

    .counter {
      display: grid;
      gap: 1rem;
      min-width: 16rem;
      padding: 1.5rem;
      color: #f4f6fb;
      background: #172033;
      border: 1px solid #303b50;
      border-radius: 1rem;
      box-shadow: 0 1rem 2.5rem rgb(23 32 51 / 20%);
      text-align: center;
    }

    output {
      font-size: 3rem;
      font-weight: 800;
      line-height: 1;
    }

    button {
      padding: 0.75rem 1rem;
      color: #18100e;
      background: #ff7657;
      border: 0;
      border-radius: 0.75rem;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
      transition:
        background-color 180ms ease,
        transform 180ms ease;
    }

    button:hover {
      background: #ff8a70;
      transform: translateY(-2px);
    }

    button:active {
      transform: translateY(1px);
    }

    button:focus-visible {
      outline: 3px solid #f4f6fb;
      outline-offset: 3px;
    }

    @media (prefers-reduced-motion: reduce) {
      button {
        transition: none;
      }
    }
  </style>

  <section class="counter">
    <span>JavaScript, written in HTML.</span>
    <output aria-live="polite">{count}</output>
    <button id="increment" type="button">Make it count</button>
  </section>

  <event target="#increment" type="click">
    <set name="count" op="++"></set>
  </event>
</component>
`;
}

export async function createStarterComponent(
  rawTagName: string,
  options: { outputPath?: string; force?: boolean } = {}
): Promise<StarterOutcome> {
  const tagName = rawTagName.trim().toLowerCase();
  if (!VALID_CUSTOM_ELEMENT_NAME.test(tagName)) {
    return {
      success: false,
      errors: [
        {
          type: 'validation',
          message: `"${rawTagName}" is not a valid custom element name.`,
          hint: 'Use lowercase words separated by a hyphen, such as "click-counter".',
        },
      ],
    };
  }

  const outputPath = path.resolve(options.outputPath ?? `${tagName}.html`);
  const pathErrors = [
    ...SecurityValidator.validateFilePath(outputPath),
    ...SecurityValidator.validateFileExtension(outputPath, ['html', 'htm']),
  ];
  if (pathErrors.length > 0) {
    return { success: false, errors: pathErrors };
  }

  const source = buildStarterComponent(tagName);
  const validation = parseHTML(source, {
    strictMode: true,
    outputFormat: 'esm',
    mode: 'component',
  });
  if (!validation.success) {
    return { success: false, source, errors: validation.errors };
  }

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, source, {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx',
    });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'EEXIST') {
      return {
        success: false,
        source,
        errors: [
          {
            type: 'validation',
            message: `File already exists: ${outputPath}`,
            hint: 'Choose another --output path or pass --force to replace it.',
          },
        ],
      };
    }
    return {
      success: false,
      source,
      errors: [
        {
          type: 'runtime',
          message: `Failed to create starter: ${String(error)}`,
        },
      ],
    };
  }

  return {
    success: true,
    outputPath,
    tagName,
    source,
    errors: [],
  };
}

export function extractComponentTagName(htmlContent: string): string | null {
  const match = htmlContent.match(/<component[^>]*\bname=["']([^"']+)["']/i);
  if (!match) return null;
  const tag = match[1].trim().toLowerCase();
  return tag.length > 0 ? tag : null;
}

export function titleFromTagName(tagName: string | null | undefined): string {
  if (!tagName) return 'HTMS Preview';
  return tagName
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PreviewOptions {
  tagName: string;
  scriptPath: string;
  title?: string;
  enableReload?: boolean;
  reloadEndpoint?: string;
  diagnostics?: PreviewDiagnostic[];
}

export interface PreviewDiagnostic {
  level: 'error' | 'warning';
  message: string;
  type?: string;
  line?: number;
  column?: number;
  hint?: string;
}

export function buildPreviewHtml(options: PreviewOptions): string {
  const tagName = options.tagName.trim().toLowerCase() || 'htms-preview';
  const title = escapeHtml(options.title ?? titleFromTagName(tagName));
  const reloadEndpoint = options.reloadEndpoint ?? '/__htms_reload';
  const enableReload = options.enableReload ?? false;
  const initialDiagnostics = JSON.stringify(options.diagnostics ?? [])
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const reloadScript = enableReload
    ? `
<script>
  const panel = document.querySelector('#__htms_diagnostics');
  const list = document.querySelector('#__htms_diagnostic_list');
  const heading = document.querySelector('#__htms_diagnostic_heading');

  function showDiagnostics(items) {
    list.replaceChildren();
    panel.hidden = items.length === 0;
    if (items.length === 0) return;

    const errorCount = items.filter(item => item.level === 'error').length;
    heading.textContent = errorCount > 0
      ? 'This component needs a quick fix'
      : 'Compiled with a warning';

    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'htms-diagnostic htms-diagnostic-' + item.level;

      const location = item.line
        ? 'Line ' + item.line + (item.column ? ':' + item.column : '')
        : item.level;
      const label = document.createElement('strong');
      label.textContent = location;
      const message = document.createElement('p');
      message.textContent = item.message;
      card.append(label, message);

      if (item.hint) {
        const hint = document.createElement('small');
        hint.textContent = item.hint;
        card.append(hint);
      }
      list.append(card);
    }
  }

  showDiagnostics(${initialDiagnostics});

  const source = new EventSource(${JSON.stringify(reloadEndpoint)});
  source.addEventListener('compiled', () => window.location.reload());
  source.addEventListener('diagnostics', event => {
    try {
      showDiagnostics(JSON.parse(event.data));
    } catch {
      showDiagnostics([{
        level: 'error',
        message: 'The dev server sent an unreadable diagnostic.'
      }]);
    }
  });
</script>`
    : '';

  return `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E">
<title>${title}</title>
<style>
  :root {
    color-scheme: light dark;
    --page: #f6f7fb;
    --surface: #ffffff;
    --ink: #172033;
    --accent: #d94828;
    font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
    background: var(--page);
  }

  body {
    min-height: 100dvh;
    margin: 0;
    color: var(--ink);
    background:
      radial-gradient(
        circle at 15% 15%,
        rgb(255 118 87 / 20%),
        transparent 32rem
      ),
      var(--page);
  }

  main {
    display: grid;
    min-height: 100dvh;
    padding: clamp(1.5rem, 5vw, 5rem);
    place-items: center;
    box-sizing: border-box;
  }

  .htms-preview-badge {
    position: fixed;
    z-index: 10;
    top: 1rem;
    right: 1rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid rgb(217 72 40 / 24%);
    border-radius: 999px;
    color: var(--accent);
    background: var(--surface);
    box-shadow: 0 0.5rem 2rem rgb(23 32 51 / 8%);
    font-size: 0.75rem;
    font-weight: 750;
    letter-spacing: 0.04em;
  }

  .htms-diagnostics {
    position: fixed;
    z-index: 20;
    inset: auto 1rem 1rem;
    width: min(42rem, calc(100vw - 2rem));
    max-height: min(70vh, 36rem);
    margin: auto;
    padding: 1rem;
    overflow: auto;
    border: 1px solid rgb(220 38 38 / 22%);
    border-radius: 1rem;
    color: var(--ink);
    background: var(--surface);
    box-shadow: 0 1.5rem 5rem rgb(15 23 42 / 24%);
    box-sizing: border-box;
  }

  .htms-diagnostics h1 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
  }

  .htms-diagnostic-list {
    display: grid;
    gap: 0.5rem;
  }

  .htms-diagnostic {
    padding: 0.75rem;
    border-left: 3px solid #d97706;
    border-radius: 0.5rem;
    background: #fffbeb;
  }

  .htms-diagnostic-error {
    border-left-color: #dc2626;
    background: #fef2f2;
  }

  .htms-diagnostic strong,
  .htms-diagnostic p,
  .htms-diagnostic small {
    display: block;
    margin: 0;
  }

  .htms-diagnostic strong,
  .htms-diagnostic small {
    font-size: 0.75rem;
  }

  .htms-diagnostic p {
    margin: 0.25rem 0;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --page: #11151d;
      --surface: #191f2a;
      --ink: #edf0f6;
      --accent: #ff7657;
    }

    .htms-diagnostic {
      background: #292108;
    }

    .htms-diagnostic-error {
      background: #321313;
    }
  }
</style>
<div class="htms-preview-badge">HTMS preview</div>
<main>
  <${tagName}></${tagName}>
</main>
<aside
  id="__htms_diagnostics"
  class="htms-diagnostics"
  aria-live="polite"
  hidden
>
  <h1 id="__htms_diagnostic_heading">Compiler feedback</h1>
  <div id="__htms_diagnostic_list" class="htms-diagnostic-list"></div>
</aside>
<script type="module" src="${options.scriptPath}"></script>${reloadScript}`;
}
