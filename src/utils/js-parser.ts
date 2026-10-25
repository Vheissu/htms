import {
  isParseError,
  parseModule,
  parseScript,
  type ESTree,
  type Options,
} from 'meriyah';

// Every JavaScript parse in the compiler goes through this module. meriyah
// builds the same ESTree acorn did in about half the time; the helpers here
// cover the two shapes the compiler needs beyond a plain program parse.

export type { ESTree };

// A comment in the shape escodegen's attachComments reads.
export interface SourceComment {
  type: 'Line' | 'Block';
  value: string;
  range: [number, number];
}

const WITH_RANGES: Options = { ranges: true };

// Parses a whole program with start, end and range on every node. Comments
// are pushed to `comments` when given. Throws a SyntaxError on invalid code.
export function parseProgram(
  source: string,
  sourceType: 'module' | 'script',
  comments?: SourceComment[]
): ESTree.Program {
  const options: Options = comments
    ? {
        ranges: true,
        onComment: (type, value, start, end): void => {
          comments.push({
            type: type === 'MultiLine' ? 'Block' : 'Line',
            value,
            range: [start, end],
          });
        },
      }
    : WITH_RANGES;
  return sourceType === 'module'
    ? parseModule(source, options)
    : parseScript(source, options);
}

interface ReadOnlyParseCache {
  script: Map<string, ESTree.Program>;
  module: Map<string, ESTree.Program>;
  count: number;
  sourceLength: number;
}

let readOnlyCache: ReadOnlyParseCache | null = null;

// Analysis passes read the same snippets repeatedly. Share their ASTs for
// one compilation, then release them, including after errors or a nested
// compile. Mutable parses (formatting and comment attachment) stay separate.
export function withReadOnlyParseCache<T>(compile: () => T): T {
  const previous = readOnlyCache;
  readOnlyCache = {
    script: new Map(),
    module: new Map(),
    count: 0,
    sourceLength: 0,
  };
  try {
    return compile();
  } finally {
    readOnlyCache = previous;
  }
}

// The returned tree must only be read. Bound both entries and source length
// so a large file cannot retain every parsed snippet until compilation ends.
export function parseReadOnlyProgram(
  source: string,
  sourceType: 'module' | 'script'
): ESTree.Program {
  const cache = readOnlyCache;
  const entries = sourceType === 'module' ? cache?.module : cache?.script;
  const cached = entries?.get(source);
  if (cached) return cached;
  const ast = parseProgram(source, sourceType);
  if (
    cache &&
    cache.count < 256 &&
    cache.sourceLength + source.length <= 65536
  ) {
    entries?.set(source, ast);
    cache.count++;
    cache.sourceLength += source.length;
  }
  return ast;
}

export interface ExpressionPrefix {
  expression: ESTree.Expression;
  // Where the expression stops within the code it was read from.
  end: number;
}

// Parses the expression at the start of `code`, leaving it to the caller
// whether text after it is acceptable. The code is read inside `(...\n)` so
// an object literal or a trailing line comment parses; node positions are
// therefore one greater than in `code`. Null when `code` does not start
// with an expression.
export function parseExpressionPrefix(code: string): ExpressionPrefix | null {
  let program: ESTree.Program;
  try {
    program = parseReadOnlyProgram(`(${code}\n)`, 'script');
  } catch {
    return null;
  }
  const [statement] = program.body;
  if (program.body.length !== 1 || statement.type !== 'ExpressionStatement') {
    return null;
  }
  const expression = statement.expression;
  const start = expression.start as number;
  const end = expression.end as number;
  // An expression that reaches the added parentheses was closed by them.
  if (start < 1 || end > code.length + 1) return null;
  return { expression, end: end - 1 };
}

// The line a parse error was raised on, when `error` is one.
export function parseErrorLine(error: unknown): number | undefined {
  return isParseError(error) ? error.loc.start.line : undefined;
}
