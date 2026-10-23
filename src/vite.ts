import { readFile } from 'node:fs/promises';
import { parseHTML } from './parser';
import { CompilerError, CompilerWarning, ParseOptions } from './types';

export type HtmsViteOptions = Pick<
  ParseOptions,
  'strictMode' | 'renderer' | 'maxFileSize'
>;

interface PluginDiagnostic {
  message: string;
  id: string;
  loc?: { file: string; line: number; column: number };
}

interface LoadContext {
  addWatchFile(id: string): void;
  warn(diagnostic: PluginDiagnostic): void;
  error(diagnostic: PluginDiagnostic): never;
}

interface CompiledModule {
  code: string;
  map: null;
  moduleSideEffects: true;
}

interface HotUpdateContext<T> {
  modules: T[];
  timestamp: number;
  server: {
    moduleGraph: {
      invalidateModule(
        module: T,
        seen: Set<T>,
        timestamp: number,
        isHmr: boolean
      ): void;
    };
    ws: { send(payload: { type: 'full-reload' }): void };
  };
}

function componentPath(id: string): string | undefined {
  const queryStart = id.indexOf('?');
  if (queryStart < 0 || id.startsWith('\0')) return undefined;
  const file = id.slice(0, queryStart);
  const query = new URLSearchParams(id.slice(queryStart + 1));
  if (
    !/\.html?$/i.test(file) ||
    !query.has('htms') ||
    query.has('raw') ||
    query.has('url')
  ) {
    return undefined;
  }
  return file;
}

function diagnosticFor(
  diagnostic: CompilerError | CompilerWarning,
  id: string,
  file: string
): PluginDiagnostic {
  return {
    message: diagnostic.hint
      ? `${diagnostic.message}\n${diagnostic.hint}`
      : diagnostic.message,
    id,
    ...(diagnostic.line !== undefined && diagnostic.source !== 'generated'
      ? {
          loc: {
            file,
            line: diagnostic.line,
            column: Math.max(0, (diagnostic.column ?? 1) - 1),
          },
        }
      : {}),
  };
}

/** Compile explicit `./component.html?htms` imports in Vite. */
export function htms(options: HtmsViteOptions = {}): {
  name: string;
  enforce: 'pre';
  load(this: LoadContext, id: string): Promise<CompiledModule | null>;
  handleHotUpdate<T extends { id: string | null }>(
    context: HotUpdateContext<T>
  ): [] | undefined;
} {
  const maxFileSize = options.maxFileSize ?? 1048576;
  if (!Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
    throw new RangeError('maxFileSize must be a positive integer');
  }
  return {
    name: 'htms',
    enforce: 'pre',
    async load(id): Promise<CompiledModule | null> {
      const file = componentPath(id);
      if (!file) return null;
      this.addWatchFile(file);
      let source: string;
      try {
        // Read only the explicit module path passed through Vite's loader.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        source = await readFile(file, 'utf8');
      } catch (error) {
        return this.error({
          message: `Cannot read HTMS component: ${error instanceof Error ? error.message : String(error)}`,
          id,
        });
      }
      if (Buffer.byteLength(source, 'utf8') > maxFileSize) {
        return this.error({
          message: `File too large. Maximum size: ${maxFileSize} bytes`,
          id,
        });
      }
      const result = parseHTML(source, {
        ...options,
        mode: 'component',
        outputFormat: 'esm',
      });
      for (const warning of result.warnings) {
        this.warn(diagnosticFor(warning, id, file));
      }
      if (!result.success || result.code === undefined) {
        const error = result.errors[0] ?? {
          message: 'HTMS compilation did not produce JavaScript',
        };
        return this.error(diagnosticFor(error, id, file));
      }
      return { code: result.code, map: null, moduleSideEffects: true };
    },
    handleHotUpdate({ modules, timestamp, server }): [] | undefined {
      if (!modules.some((module) => module.id && componentPath(module.id))) {
        return undefined;
      }
      // Custom element classes cannot be redefined. Invalidate every import
      // of this file (including ?raw) before reloading the document.
      const invalidated = new Set<(typeof modules)[number]>();
      for (const module of modules) {
        server.moduleGraph.invalidateModule(
          module,
          invalidated,
          timestamp,
          true
        );
      }
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default htms;
