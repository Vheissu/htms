import { CompilerError, HandlerResult } from '../types';

// The errors and warnings a tag handler collects, with shortcuts that
// report under the handler's tag.
export interface HandlerDiagnostics {
  errors: HandlerResult['errors'];
  warnings: HandlerResult['warnings'];
  // The empty result a handler stops with.
  empty(): HandlerResult;
  // Records `found` under the handler's tag.
  report(found: readonly CompilerError[]): void;
  // Records an error and returns the empty result.
  fail(message: string, type?: CompilerError['type']): HandlerResult;
  // Records `found` and returns the empty result.
  failWith(found: readonly CompilerError[]): HandlerResult;
}

export function handlerDiagnostics(tag: string): HandlerDiagnostics {
  const errors: HandlerResult['errors'] = [];
  const warnings: HandlerResult['warnings'] = [];
  const empty = (): HandlerResult => ({ code: '', errors, warnings });
  const report = (found: readonly CompilerError[]): void => {
    errors.push(...found.map((error) => ({ ...error, tag })));
  };
  return {
    errors,
    warnings,
    empty,
    report,
    fail: (message, type = 'validation'): HandlerResult => {
      errors.push({ type, message, tag });
      return empty();
    },
    failWith: (found): HandlerResult => {
      report(found);
      return empty();
    },
  };
}
