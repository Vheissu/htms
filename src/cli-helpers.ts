import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { parseHTML } from './parser';
import { CompilerLogger } from './utils/logger';
import { SecurityValidator } from './utils/security';
import {
  ComponentArtifact,
  CompilerError,
  CompilerWarning,
  ParseOptions
} from './types';

export type OutputFormat = 'esm' | 'cjs' | 'iife';

export interface CliCompileOptions {
  outputPath?: string;
  format: OutputFormat;
  strict: boolean;
  maxSize: number;
  mode?: 'component';
}

export interface CompileOutcome {
  success: boolean;
  outputPath?: string;
  code?: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
  components?: ComponentArtifact[];
}

export function resolveOutputPath(inputPath: string, outputPath?: string): string {
  if (outputPath) return outputPath;
  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(path.dirname(inputPath), `${baseName}.js`);
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
      message: 'Only component mode is supported.'
    });
    return { success: false, errors, warnings };
  }

  const validationErrors = SecurityValidator.validateFilePath(inputPath);
  if (validationErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid input file path', {
      input: inputPath,
      errors: validationErrors
    });
    return { success: false, errors: validationErrors, warnings };
  }

  const extensionErrors = SecurityValidator.validateFileExtension(inputPath, [
    'html',
    'htm'
  ]);
  if (extensionErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid file extension', {
      input: inputPath,
      errors: extensionErrors
    });
    return { success: false, errors: extensionErrors, warnings };
  }

  try {
    await fs.access(inputPath, fsSync.constants.R_OK);
  } catch {
    const error: CompilerError = {
      type: 'validation',
      message: `Cannot read file: ${inputPath}`
    };
    CompilerLogger.logValidationError('File not accessible', { input: inputPath });
    return { success: false, errors: [error], warnings };
  }

  let stats: fsSync.Stats;
  try {
    stats = await fs.stat(inputPath);
  } catch (error) {
    const err: CompilerError = {
      type: 'runtime',
      message: `Failed to read file stats: ${String(error)}`
    };
    CompilerLogger.logCompilerError('File stat failed', { input: inputPath, error });
    return { success: false, errors: [err], warnings };
  }

  if (stats.size > options.maxSize) {
    const error: CompilerError = {
      type: 'validation',
      message: `File too large. Maximum size: ${options.maxSize} bytes`
    };
    CompilerLogger.logValidationError('File too large', {
      input: inputPath,
      size: stats.size,
      maxSize: options.maxSize
    });
    return { success: false, errors: [error], warnings };
  }

  let htmlContent = '';
  try {
    htmlContent = await fs.readFile(inputPath, 'utf8');
  } catch (error) {
    const err: CompilerError = {
      type: 'runtime',
      message: `Failed to read file: ${String(error)}`
    };
    CompilerLogger.logCompilerError('File read failed', { input: inputPath, error });
    return { success: false, errors: [err], warnings };
  }

  const contentErrors = SecurityValidator.validateContent(htmlContent);
  if (contentErrors.length > 0) {
    CompilerLogger.logSecurityIssue('Dangerous content detected', {
      input: inputPath,
      errors: contentErrors
    });
    return { success: false, errors: contentErrors, warnings };
  }

  const parseOptions: ParseOptions = {
    maxFileSize: options.maxSize,
    strictMode: options.strict,
    outputFormat: options.format,
    mode: 'component'
  };

  CompilerLogger.logInfo('Starting compilation', {
    input: inputPath,
    options: parseOptions
  });

  const result = parseHTML(htmlContent, parseOptions);
  errors.push(...result.errors);
  warnings.push(...result.warnings);

  if (!result.success || !result.code) {
    CompilerLogger.logCompilerError('Compilation failed', {
      input: inputPath,
      errors: result.errors
    });
    return {
      success: false,
      errors,
      warnings,
      components: result.components
    };
  }

  const outputPath = resolveOutputPath(inputPath, options.outputPath);
  const outputValidationErrors = SecurityValidator.validateFilePath(outputPath);
  if (outputValidationErrors.length > 0) {
    CompilerLogger.logValidationError('Invalid output file path', {
      outputPath,
      errors: outputValidationErrors
    });
    return { success: false, errors: outputValidationErrors, warnings };
  }

  try {
    await fs.writeFile(outputPath, result.code);
  } catch (error) {
    const err: CompilerError = {
      type: 'runtime',
      message: `Failed to write output: ${String(error)}`
    };
    CompilerLogger.logCompilerError('Output write failed', {
      outputPath,
      error
    });
    return { success: false, errors: [err], warnings };
  }

  const duration = Date.now() - startTime;
  CompilerLogger.logPerformanceMetric('compilation', duration, {
    input: inputPath,
    output: outputPath,
    codeLength: result.code.length
  });

  return {
    success: true,
    outputPath,
    code: result.code,
    errors: [],
    warnings,
    components: result.components
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
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
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
}

export function buildPreviewHtml(options: PreviewOptions): string {
  const tagName = options.tagName.trim().toLowerCase() || 'htms-preview';
  const title = escapeHtml(options.title ?? titleFromTagName(tagName));
  const reloadEndpoint = options.reloadEndpoint ?? '/__htms_reload';
  const enableReload = options.enableReload ?? false;

  const reloadScript = enableReload
    ? `\n<script>\n  const source = new EventSource('${reloadEndpoint}');\n  source.onmessage = () => window.location.reload();\n</script>`
    : '';

  return `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 32px; }
  main { display: grid; gap: 24px; }
</style>
<main>
  <${tagName}></${tagName}>
</main>
<script type="module" src="${options.scriptPath}"></script>${reloadScript}`;
}
