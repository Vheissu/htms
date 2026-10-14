import { TagHandlerOptions } from '../types';
import { ESTree, parseProgram } from '../utils/js-parser';

// Component expressions are written against the component's fields:
// `count + 1`, `todos.length`, `format(price)`. The generated code runs as
// class methods, so a bare field reference must become `this.count`. This
// module rewrites free identifiers that name a component field, leaving
// locals (loop variables, `event`, names declared inside the snippet),
// member properties, object keys and globals untouched.

export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export function isNode(value: unknown): value is AstNode {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

// Calls `visit` with every child node and the property holding it, without
// building an entries array per node (this runs over every expression).
export function forEachChild(
  node: AstNode,
  visit: (key: string, child: AstNode) => void
): void {
  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value: unknown = Reflect.get(node, key);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) visit(key, item);
      }
    } else if (isNode(value)) {
      visit(key, value);
    }
  }
}

export function collectPatternNames(
  pattern: unknown,
  names: Set<string>
): void {
  if (!isNode(pattern)) return;
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name as string);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties as AstNode[]) {
        collectPatternNames(
          property.type === 'RestElement' ? property.argument : property.value,
          names
        );
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements as Array<AstNode | null>) {
        collectPatternNames(element, names);
      }
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument, names);
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, names);
      break;
  }
}

// Names declared anywhere in the snippet shadow fields everywhere in it.
// This is deliberately conservative: a declared local is never rewritten.
function collectDeclaredNames(root: AstNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: AstNode): void => {
    switch (node.type) {
      case 'VariableDeclarator':
        collectPatternNames(node.id, names);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (isNode(node.id)) collectPatternNames(node.id, names);
        for (const param of node.params as AstNode[]) {
          collectPatternNames(param, names);
        }
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (isNode(node.id)) collectPatternNames(node.id, names);
        break;
      case 'CatchClause':
        collectPatternNames(node.param, names);
        break;
    }
    forEachChild(node, (_key, child) => visit(child));
  };
  visit(root);
  return names;
}

function collectReplacements(
  root: AstNode,
  fields: ReadonlySet<string>,
  shadowed: ReadonlySet<string>
): Replacement[] {
  const replacements: Replacement[] = [];
  const shouldRewrite = (name: string): boolean =>
    fields.has(name) && !shadowed.has(name);

  // `inPlainFunction` tracks non-arrow functions, where `this` is no longer
  // the component and rewriting would change meaning.
  const visit = (
    node: AstNode,
    parent: AstNode | null,
    key: string,
    inPlainFunction: boolean
  ): void => {
    if (node.type === 'Identifier') {
      const name = node.name as string;
      if (
        !inPlainFunction &&
        shouldRewrite(name) &&
        (!parent || isReference(node, parent, key))
      ) {
        replacements.push({
          start: node.start,
          end: node.end,
          text: `this.${name}`,
        });
      }
      return;
    }

    if (
      node.type === 'Property' &&
      node.shorthand === true &&
      isNode(node.key) &&
      node.key.type === 'Identifier' &&
      parent?.type === 'ObjectExpression'
    ) {
      const name = node.key.name as string;
      if (!inPlainFunction && shouldRewrite(name)) {
        replacements.push({
          start: node.start,
          end: node.end,
          text: `${name}: this.${name}`,
        });
      }
      return;
    }

    const nextInPlainFunction =
      inPlainFunction ||
      node.type === 'FunctionExpression' ||
      node.type === 'FunctionDeclaration';
    forEachChild(node, (childKey, child) =>
      visit(child, node, childKey, nextInPlainFunction)
    );
  };

  visit(root, null, '', false);
  return replacements;
}

function isReference(_node: AstNode, parent: AstNode, key: string): boolean {
  switch (parent.type) {
    case 'MemberExpression':
      return key === 'object' || parent.computed === true;
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      if (key === 'key') return parent.computed === true;
      return parent.type === 'Property' && key === 'value';
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return false;
    case 'MetaProperty':
      return false;
    case 'VariableDeclarator':
      return key === 'init';
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return key === 'body' || key === 'superClass';
    case 'CatchClause':
      return false;
    default:
      return true;
  }
}

function applyReplacements(
  source: string,
  replacements: Replacement[]
): string {
  let output = source;
  for (const replacement of [...replacements].sort(
    (left, right) => right.start - left.start
  )) {
    output =
      output.slice(0, replacement.start) +
      replacement.text +
      output.slice(replacement.end);
  }
  return output;
}

function mentionsField(code: string, fields: ReadonlySet<string>): boolean {
  for (const field of fields) {
    if (code.includes(field)) return true;
  }
  return false;
}

// Snippets may use `await` and `return` at their top level, since event
// actions and method bodies become (async) methods. A script allows
// neither, so a snippet is parsed as the body of an async arrow function:
// an expression inside `(...)`, which also lets object literals and a
// trailing line comment parse, or statements inside `{...}`. Node positions
// are shifted by the prefix length. The arrow must come out as the whole
// program, so a snippet that closes the wrapper early does not parse.
// Node positions in the result are offset by `EXPRESSION_OFFSET` or
// `STATEMENTS_OFFSET`.
const EXPRESSION_PREFIX = '(async () => (';
const STATEMENTS_PREFIX = '(async () => {\n';
export const EXPRESSION_OFFSET = EXPRESSION_PREFIX.length;
export const STATEMENTS_OFFSET = STATEMENTS_PREFIX.length;

export function parseSnippet(
  code: string,
  asExpression: boolean
): AstNode | null {
  const wrapped = asExpression
    ? `${EXPRESSION_PREFIX}${code}\n))`
    : `${STATEMENTS_PREFIX}${code}\n})`;
  let program: ESTree.Program;
  try {
    program = parseProgram(wrapped, 'script');
  } catch {
    return null;
  }
  const [statement] = program.body;
  if (program.body.length !== 1 || statement.type !== 'ExpressionStatement') {
    return null;
  }
  const arrow = statement.expression;
  if (
    arrow.type !== 'ArrowFunctionExpression' ||
    arrow.expression !== asExpression ||
    arrow.start !== 1 ||
    arrow.end !== wrapped.length - 1
  ) {
    return null;
  }
  return arrow.body as unknown as AstNode;
}

// Parses `code` as exactly one expression.
function parseExpressionExactly(code: string): AstNode | null {
  return parseSnippet(code, true);
}

function rewrite(
  code: string,
  root: AstNode,
  fields: ReadonlySet<string>,
  locals: readonly string[],
  offset = 0
): string {
  const shadowed = collectDeclaredNames(root);
  for (const local of locals) shadowed.add(local);
  const replacements = collectReplacements(root, fields, shadowed).map(
    (replacement) => ({
      ...replacement,
      start: replacement.start - offset,
      end: replacement.end - offset,
    })
  );
  return replacements.length > 0 ? applyReplacements(code, replacements) : code;
}

// Rewrites a single JavaScript expression. Returns the input unchanged when
// it does not parse, so later validation can report the real syntax error.
export function scopeExpression(
  code: string,
  fields: ReadonlySet<string>,
  locals: readonly string[] = []
): string {
  if (fields.size === 0 || !mentionsField(code, fields)) return code;
  const root = parseExpressionExactly(code);
  return root ? rewrite(code, root, fields, locals, EXPRESSION_OFFSET) : code;
}

// Rewrites a block of statements (an event action, a method body).
export function scopeStatements(
  code: string,
  fields: ReadonlySet<string>,
  locals: readonly string[] = []
): string {
  if (fields.size === 0 || !mentionsField(code, fields)) return code;
  const root = parseSnippet(code, false);
  return root ? rewrite(code, root, fields, locals, STATEMENTS_OFFSET) : code;
}

// Returns the free identifiers an expression reads (used to decide whether
// `{...}` in markup is an interpolation or literal text).
export function expressionReferences(code: string): Set<string> | null {
  const root = parseExpressionExactly(code);
  if (!root) return null;
  const shadowed = collectDeclaredNames(root);
  const names = new Set<string>();
  const visit = (node: AstNode, parent: AstNode | null, key: string): void => {
    if (node.type === 'Identifier' && parent) {
      if (
        isReference(node, parent, key) &&
        !shadowed.has(node.name as string)
      ) {
        names.add(node.name as string);
      }
      return;
    }
    if (node.type === 'ThisExpression') {
      names.add('this');
    }
    if (node.type === 'Identifier' && !parent) {
      names.add(node.name as string);
      return;
    }
    forEachChild(node, (childKey, child) => visit(child, node, childKey));
  };
  visit(root, null, '');
  return names;
}

// Convenience wrapper for tag handlers: rewrites with the fields and locals
// carried in the handler options. Outside a component it is a no-op.
export interface HandlerScope {
  expression(code: string, extraLocals?: readonly string[]): string;
  statements(code: string, extraLocals?: readonly string[]): string;
  isReference: ((root: string) => boolean) | undefined;
}

export function handlerScope(options: TagHandlerOptions): HandlerScope {
  const fields = options.componentFields;
  const locals = options.localNames ?? [];
  if (!fields) {
    return {
      expression: (code) => code,
      statements: (code) => code,
      isReference: undefined,
    };
  }
  return {
    expression: (code, extraLocals = []) =>
      scopeExpression(code, fields, [...locals, ...extraLocals]),
    statements: (code, extraLocals = []) =>
      scopeStatements(code, fields, [...locals, ...extraLocals]),
    isReference: (root) => fields.has(root) || locals.includes(root),
  };
}

export function withLocals(
  options: TagHandlerOptions,
  ...names: Array<string | undefined>
): TagHandlerOptions {
  const added = names.filter((name): name is string => !!name);
  if (added.length === 0) return options;
  return { ...options, localNames: [...(options.localNames ?? []), ...added] };
}
