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
    program = parseScript(`(${code}\n)`, WITH_RANGES);
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
