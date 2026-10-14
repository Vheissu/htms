import { ComponentIR, DirectiveNode, TemplateNode } from './ir';
import {
  AstNode,
  collectPatternNames,
  forEachChild,
  isNode,
  parseSnippet,
} from './scope';

// Dirty tracking for block-rendered components.
//
// Every component field (state, prop or derived value) owns a bit. Setters
// and state helpers set the bit of the field they change, and each binding in
// the generated update code is guarded by the mask of fields its expression
// reads, so a render touches only the bindings that could have changed.
//
// Masks come from the expressions and method bodies the author already
// wrote; nothing is annotated. The analysis errs towards "everything is
// dirty" (`ALL_DIRTY`, every bit set) wherever a value cannot be traced:
// calls to unknown functions, reads of globals that may change, objects
// reaching the component from outside.
//
// Nested writes (`rows[i].label = x`, `items.push(x)`) do not go through a
// setter, so methods and handlers that perform them report an explicit
// mask afterwards. Because two fields can share an object (`editing = todo`
// hands a row of `todos` to `editing`), fields connected by an assignment
// form an alias class, and a nested write through one marks the whole class.
// A field that bindings only ever compare or test (`row.id === selected`)
// cannot show an in-place change, so it is left out of the masks nested
// writes report.
//
// A reported mask also says how deep the write went. `DEEP_BIT` means an
// object inside a field changed (`rows[i].label = x`, or anything through a
// value whose origin is unknown); without it only the field's own value or
// its direct elements changed (`rows[1] = row`, `rows.push(row)`), so a list
// row that kept its item has nothing to update.

export const ALL_DIRTY = -1;
// Set when a write may have changed an object held inside a field.
export const DEEP_BIT = 1 << 30;
// Fields beyond the individual bits share this one.
const SHARED_BIT = 1 << 29;
const INDIVIDUAL_BITS = 29;

// Identifiers whose members and calls read nothing that changes behind the
// component's back. `Date.now`, `new Date()` and `Math.random` are the
// exceptions, handled where calls are analysed.
const PURE_GLOBALS = new Set([
  'Array',
  'BigInt',
  'Boolean',
  'Date',
  'Error',
  'Infinity',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'structuredClone',
  'undefined',
]);

// Members of pure globals whose value changes between calls.
const VOLATILE_STATICS = new Set(['Date.now', 'Math.random']);

// Static methods on pure globals that mutate their first argument.
const MUTATING_STATICS = new Set([
  'Object.assign',
  'Object.defineProperties',
  'Object.defineProperty',
  'Object.setPrototypeOf',
  'Reflect.defineProperty',
  'Reflect.deleteProperty',
  'Reflect.set',
  'Reflect.setPrototypeOf',
]);

// Methods on arrays, strings, numbers, dates, maps and sets that leave the
// receiver unchanged. Anything else called on a field is taken to change it.
const PURE_METHODS = new Set([
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'concat',
  'endsWith',
  'entries',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'get',
  'getDate',
  'getDay',
  'getFullYear',
  'getHours',
  'getMilliseconds',
  'getMinutes',
  'getMonth',
  'getSeconds',
  'getTime',
  'getTimezoneOffset',
  'has',
  'hasOwnProperty',
  'includes',
  'indexOf',
  'isPrototypeOf',
  'join',
  'keys',
  'lastIndexOf',
  'localeCompare',
  'map',
  'match',
  'matchAll',
  'normalize',
  'padEnd',
  'padStart',
  'reduce',
  'reduceRight',
  'repeat',
  'replace',
  'replaceAll',
  'search',
  'slice',
  'some',
  'split',
  'startsWith',
  'substring',
  'toExponential',
  'toFixed',
  'toISOString',
  'toJSON',
  'toLocaleDateString',
  'toLocaleLowerCase',
  'toLocaleString',
  'toLocaleTimeString',
  'toLocaleUpperCase',
  'toLowerCase',
  'toPrecision',
  'toReversed',
  'toSorted',
  'toSpliced',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
  'values',
  'with',
]);

// Component helpers whose first argument is a state path literal.
const PATH_HELPERS = new Set([
  '__htmsInitState',
  '__htmsPushState',
  '__htmsSetState',
  '__htmsSpliceState',
]);

// Public helpers that read nothing reactive and change no state.
const INERT_HELPERS = new Set(['emit']);
// Public helpers that read the DOM, which any render may have changed.
const DOM_HELPERS = new Set(['$', '$$']);

export interface DependencyFieldSets {
  // State roots and props: reactive values behind class accessors.
  reactive: readonly string[];
  // Derived values with the expression computing each one.
  derived: ReadonlyMap<string, string>;
  // Methods with their parameter names and compiled body.
  methods: ReadonlyMap<string, MethodCode>;
}

export interface MethodCode {
  params: readonly string[];
  body: string;
}

// Names declared outside a snippet, each with the fields its value may
// come from (alias collection) or a mask (read and write analysis).
type FieldSources = ReadonlyMap<string, ReadonlySet<string>>;
type Masks = ReadonlyMap<string, number>;

function memberName(node: AstNode): string | null {
  const property = node.property;
  if (node.computed === true) {
    return isNode(property) && property.type === 'Literal'
      ? String(property.value)
      : null;
  }
  return isNode(property) && property.type === 'Identifier'
    ? (property.name as string)
    : null;
}

// Splits `a.b.c` into its root node and property names, outermost first.
// A computed segment whose key is not a literal is null.
function memberChain(node: AstNode): {
  root: AstNode;
  names: Array<string | null>;
} {
  const names: Array<string | null> = [];
  let current = node;
  for (;;) {
    if (current.type === 'ChainExpression') {
      current = current.expression as AstNode;
    } else if (current.type === 'MemberExpression') {
      names.unshift(memberName(current));
      current = current.object as AstNode;
    } else {
      return { root: current, names };
    }
  }
}

// Calls `visit` with every computed key expression in a member chain.
function forEachComputedKey(
  node: AstNode,
  visit: (key: AstNode, owner: AstNode) => void
): void {
  let current = node;
  for (;;) {
    if (current.type === 'ChainExpression') {
      current = current.expression as AstNode;
    } else if (current.type === 'MemberExpression') {
      if (current.computed === true) {
        visit(current.property as AstNode, current);
      }
      current = current.object as AstNode;
    } else {
      return;
    }
  }
}

function pathLiteral(node: AstNode | undefined): string[] | null {
  if (!node || node.type !== 'ArrayExpression') return null;
  const path: string[] = [];
  for (const element of node.elements as Array<AstNode | null>) {
    if (
      !element ||
      element.type !== 'Literal' ||
      typeof element.value !== 'string'
    ) {
      return null;
    }
    path.push(element.value);
  }
  return path.length > 0 ? path : null;
}

function pathLiteralRoot(node: AstNode | undefined): string | null {
  return pathLiteral(node)?.[0] ?? null;
}

// Whether a value in this position is only compared or tested, so an
// in-place change to the object it holds can never show.
function isShallowContext(parent: AstNode | null, key: string): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case 'BinaryExpression':
      return parent.operator === '===' || parent.operator === '!==';
    case 'UnaryExpression':
      return parent.operator === '!' || parent.operator === 'typeof';
    case 'LogicalExpression':
      return parent.operator === '&&' && key === 'left';
    case 'IfStatement':
    case 'ConditionalExpression':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
      return key === 'test';
    default:
      return false;
  }
}

// Adds the deep bit to a mask that reports a write, unless there is nothing
// to report.
function deepen(mask: number): number {
  return mask === 0 ? 0 : mask | DEEP_BIT;
}

// Whether a state helper writing `path` reaches inside an object held by
// the root field: a nested path, or an element write (push, splice) to
// anything below the root.
export function pathWriteIsDeep(
  path: readonly string[],
  elementWrite: boolean
): boolean {
  return path.length + (elementWrite ? 1 : 0) > 2;
}

function isPropertyKey(parent: AstNode | null, key: string): boolean {
  if (!parent) return false;
  if (parent.type === 'MemberExpression') {
    return key === 'property' && parent.computed !== true;
  }
  if (
    parent.type === 'Property' ||
    parent.type === 'PropertyDefinition' ||
    parent.type === 'MethodDefinition'
  ) {
    return key === 'key' && parent.computed !== true;
  }
  return (
    parent.type === 'LabeledStatement' ||
    parent.type === 'BreakStatement' ||
    parent.type === 'ContinueStatement'
  );
}

function declaredNames(node: AstNode, names: Set<string>): void {
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
}

function allDeclaredNames(root: AstNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: AstNode): void => {
    declaredNames(node, names);
    forEachChild(node, (_key, child) => visit(child));
  };
  visit(root);
  return names;
}

function isPureMethod(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && PURE_METHODS.has(name);
}

function loopVariableNames(left: AstNode): Set<string> {
  const names = new Set<string>();
  if (left.type === 'VariableDeclaration') {
    for (const declarator of left.declarations as AstNode[]) {
      collectPatternNames(declarator.id, names);
    }
  } else {
    collectPatternNames(left, names);
  }
  return names;
}

export class DependencyAnalyzer {
  private readonly bits = new Map<string, number>();
  private readonly derived: ReadonlyMap<string, string>;
  private readonly methods: ReadonlyMap<string, MethodCode>;
  // Union-find over field indexes for alias classes.
  private readonly parents = new Map<number, number>();
  private readonly names: string[] = [];
  private sealed = false;
  private readsComplete = false;
  // Bits of the fields some binding reads beyond comparing or testing them.
  private deepReads = 0;
  private readonly classMasks = new Map<string, number>();
  private readonly classSizes = new Map<string, number>();
  private readonly fieldReads = new Map<string, number>();
  private readonly methodReads = new Map<string, number>();
  private readonly methodWrites = new Map<string, number>();
  private readonly inProgress = new Set<string>();
  // The fields each method's call sites pass for each parameter.
  private paramSources = new Map<string, ReadonlyArray<ReadonlySet<string>>>();

  constructor(fields: DependencyFieldSets) {
    this.derived = fields.derived;
    this.methods = fields.methods;
    for (const name of fields.reactive) this.addField(name);
    for (const name of fields.derived.keys()) this.addField(name);
  }

  private addField(name: string): void {
    if (this.bits.has(name)) return;
    const index = this.names.length;
    this.names.push(name);
    this.parents.set(index, index);
    this.bits.set(name, index < INDIVIDUAL_BITS ? 1 << index : SHARED_BIT);
  }

  isField(name: string): boolean {
    return this.bits.has(name);
  }

  // The bit a change to `name` sets; everything for an unknown name.
  bit(name: string): number {
    return this.bits.get(name) ?? ALL_DIRTY;
  }

  // ---------------------------------------------------------------------
  // Alias classes

  private find(index: number): number {
    let root = index;
    for (;;) {
      const parent = this.parents.get(root) ?? root;
      if (parent === root) break;
      root = parent;
    }
    let current = index;
    while (current !== root) {
      const next = this.parents.get(current) ?? root;
      this.parents.set(current, root);
      current = next;
    }
    return root;
  }

  private union(left: string, right: string): void {
    if (this.sealed) throw new Error('alias classes are sealed');
    const a = this.names.indexOf(left);
    const b = this.names.indexOf(right);
    if (a < 0 || b < 0) return;
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parents.set(rootB, rootA);
  }

  // Records that `target` may share objects with the fields `code` reads.
  aliasAssignment(target: string, code: string, locals: FieldSources): void {
    if (!this.bits.has(target)) return;
    for (const field of this.fieldsIn(code, locals, true)) {
      this.union(target, field);
    }
  }

  // Records every field-to-field assignment in a statement snippet.
  aliasStatements(code: string, locals: FieldSources): void {
    const root = parseSnippet(code, false);
    if (!root) return;
    this.walkAliases(root, new Map(locals));
  }

  // No alias edge may be added after masks are computed.
  seal(): void {
    this.sealed = true;
  }

  // Records what call sites pass to each method's parameters.
  setParamSources(
    sources: ReadonlyMap<string, ReadonlyArray<ReadonlySet<string>>>
  ): void {
    this.paramSources = new Map(sources);
  }

  // Every binding has been read; write masks may now be computed.
  completeReads(): void {
    this.readsComplete = true;
  }

  private walkAliases(
    root: AstNode,
    locals: Map<string, ReadonlySet<string>>
  ): void {
    const visit = (node: AstNode): void => {
      if (node.type === 'VariableDeclarator' && isNode(node.init)) {
        const names = new Set<string>();
        collectPatternNames(node.id, names);
        const sources = this.fieldsOf(node.init, locals);
        for (const name of names) locals.set(name, sources);
      } else if (
        node.type === 'ForOfStatement' ||
        node.type === 'ForInStatement'
      ) {
        const sources = this.fieldsOf(node.right as AstNode, locals);
        for (const name of loopVariableNames(node.left as AstNode)) {
          locals.set(name, sources);
        }
      } else if (node.type === 'AssignmentExpression') {
        const target = this.fieldTarget(node.left as AstNode, locals);
        if (target) {
          for (const field of this.fieldsOf(node.right as AstNode, locals)) {
            this.union(target, field);
          }
        }
      } else if (node.type === 'CallExpression') {
        const { root: calleeRoot, names } = memberChain(node.callee as AstNode);
        const helper = names.length === 1 ? names[0] : null;
        if (
          calleeRoot.type === 'ThisExpression' &&
          helper !== null &&
          PATH_HELPERS.has(helper)
        ) {
          const [path, ...rest] = node.arguments as AstNode[];
          const target = pathLiteralRoot(path);
          if (target) {
            for (const argument of rest) {
              for (const field of this.fieldsOf(argument, locals)) {
                this.union(target, field);
              }
            }
          }
        }
      }
      forEachChild(node, (_key, child) => visit(child));
    };
    visit(root);
  }

  // The field an assignment target writes into, at any depth.
  private fieldTarget(target: AstNode, locals: FieldSources): string | null {
    const { root, names } = memberChain(target);
    if (root.type === 'ThisExpression') {
      const [first] = names;
      return first !== null && first !== undefined && this.bits.has(first)
        ? first
        : null;
    }
    if (root.type === 'Identifier') {
      const name = root.name as string;
      if (!locals.has(name) && this.bits.has(name)) return name;
    }
    return null;
  }

  // Fields a snippet mentions, through `this.x`, a bare field name or a
  // local known to hold one of their values.
  fieldsIn(
    code: string,
    locals: FieldSources,
    asExpression: boolean
  ): Set<string> {
    const root = parseSnippet(code, asExpression);
    if (!root) return new Set();
    return this.fieldsOf(root, locals);
  }

  fieldsOf(root: AstNode, locals: FieldSources): Set<string> {
    const found = new Set<string>();
    const shadowed = allDeclaredNames(root);
    const visit = (
      node: AstNode,
      parent: AstNode | null,
      key: string
    ): void => {
      if (node.type === 'MemberExpression') {
        const { root: base, names } = memberChain(node);
        if (base.type === 'ThisExpression') {
          const [first] = names;
          if (first !== null && first !== undefined && this.bits.has(first)) {
            found.add(first);
          }
          forEachComputedKey(node, (expression, owner) =>
            visit(expression, owner, 'property')
          );
          return;
        }
      }
      if (node.type === 'Identifier' && !isPropertyKey(parent, key)) {
        const name = node.name as string;
        const sources = locals.get(name);
        if (sources) {
          for (const field of sources) found.add(field);
        } else if (!shadowed.has(name) && this.bits.has(name)) {
          found.add(name);
        }
        return;
      }
      forEachChild(node, (childKey, child) => visit(child, node, childKey));
    };
    visit(root, null, '');
    return found;
  }

  // The class mask of every field in `mask`: what a write through a value
  // holding any of them must report.
  expand(mask: number): number {
    if (mask === ALL_DIRTY || mask === 0) return mask;
    let result = 0;
    for (const name of this.names) {
      if ((this.bit(name) & mask) !== 0) result |= this.classMask(name);
    }
    return result;
  }

  // Bits a nested write through `name` must report: every field that may
  // share objects with it and that some binding reads deeply. Fields only
  // compared or tested cannot show the change.
  classMask(name: string): number {
    if (!this.sealed) throw new Error('alias classes are not sealed');
    if (!this.readsComplete) throw new Error('bindings are still being read');
    const cached = this.classMasks.get(name);
    if (cached !== undefined) return cached;
    const index = this.names.indexOf(name);
    if (index < 0) return ALL_DIRTY;
    const root = this.find(index);
    let mask = 0;
    let size = 0;
    this.names.forEach((other, otherIndex) => {
      if (this.find(otherIndex) !== root) return;
      size++;
      mask |= this.bit(other) & this.deepReads;
    });
    this.classMasks.set(name, mask);
    this.classSizes.set(name, size);
    return mask;
  }

  // Mask a write reports when it changes `name`'s own value or direct
  // contents (`deep` false) or an object held further inside it. A direct
  // write counts as deep when another observable field shares the class,
  // since the write may sit inside that field (`editing = todos[1]`, then
  // `editing.title = x`).
  fieldWrite(name: string, deep: boolean): number {
    const mask = this.classMask(name);
    if (mask === 0) return 0;
    if (deep) return mask | DEEP_BIT;
    const bit = this.bit(name);
    const others =
      bit === SHARED_BIT
        ? (this.classSizes.get(name) ?? 1) > 1
        : (mask & ~bit) !== 0;
    return others ? mask | DEEP_BIT : mask;
  }

  // Mask a state helper reports for writing `path`; `elementWrite` for
  // push and splice, which change the array at the path rather than the
  // path itself.
  stateWriteMask(path: readonly string[], elementWrite: boolean): number {
    const [root] = path;
    if (root === undefined) return ALL_DIRTY;
    return this.fieldWrite(root, pathWriteIsDeep(path, elementWrite));
  }

  // ---------------------------------------------------------------------
  // Reads

  // Mask of the fields `code` reads. `locals` maps names declared outside
  // the snippet (loop variables) to the mask of their sources; names not
  // listed are globals.
  readMask(code: string, locals: Masks, asExpression: boolean): number {
    return this.readMasks(code, locals, asExpression).mask;
  }

  // As `readMask`, also reporting `direct`: the part of the mask the code
  // reads itself rather than through a local, so a loop body that reads
  // only its item has nothing to update while the item stays the same.
  readMasks(
    code: string,
    locals: Masks,
    asExpression: boolean
  ): { mask: number; direct: number } {
    const root = parseSnippet(code, asExpression);
    if (!root) {
      this.deepReads = ALL_DIRTY;
      return { mask: ALL_DIRTY, direct: ALL_DIRTY };
    }
    return this.readNode(root, locals);
  }

  // Bits a binding on `name` depends on: the field itself and, for a derived
  // value, whatever its expression reads.
  private fieldReadMask(name: string): number {
    const cached = this.fieldReads.get(name);
    if (cached !== undefined) return cached;
    const expression = this.derived.get(name);
    let mask = this.bit(name);
    if (expression !== undefined) {
      const key = `derived:${name}`;
      if (this.inProgress.has(key)) return ALL_DIRTY;
      this.inProgress.add(key);
      mask |= this.readMask(expression, new Map(), true);
      this.inProgress.delete(key);
    }
    this.fieldReads.set(name, mask);
    return mask;
  }

  methodReadMask(name: string): number {
    const cached = this.methodReads.get(name);
    if (cached !== undefined) return cached;
    const method = this.methods.get(name);
    if (method === undefined) return ALL_DIRTY;
    const key = `read:${name}`;
    if (this.inProgress.has(key)) return ALL_DIRTY;
    this.inProgress.add(key);
    // Reading a parameter reads no field; the call site adds what it passes.
    const locals = new Map(method.params.map((param) => [param, 0]));
    const mask = this.readMask(method.body, locals, false);
    this.inProgress.delete(key);
    this.methodReads.set(name, mask);
    return mask;
  }

  private readNode(
    root: AstNode,
    locals: Masks
  ): { mask: number; direct: number } {
    const declared = allDeclaredNames(root);
    let mask = 0;
    let direct = 0;
    const isGlobal = (name: string): boolean =>
      !declared.has(name) &&
      !locals.has(name) &&
      !this.bits.has(name) &&
      !this.methods.has(name);
    const everything = (): void => {
      mask = ALL_DIRTY;
      direct = ALL_DIRTY;
      this.deepReads = ALL_DIRTY;
    };
    const add = (read: number): void => {
      if (read === ALL_DIRTY) {
        everything();
        return;
      }
      mask |= read;
      direct |= read;
    };
    // A field read on its own may only be compared or tested; one read
    // through a property, a call or any other use is read deeply.
    const field = (name: string, shallow: boolean): void => {
      add(this.fieldReadMask(name));
      if (!shallow) this.deepReads |= this.bit(name);
    };
    const visit = (
      node: AstNode,
      parent: AstNode | null,
      key: string
    ): void => {
      if (mask === ALL_DIRTY) return;
      switch (node.type) {
        case 'Literal':
        case 'TemplateElement':
          return;
        case 'ThisExpression':
        case 'Super':
        case 'MetaProperty':
          // `this` on its own could be read any way at all.
          everything();
          return;
        case 'Identifier': {
          if (isPropertyKey(parent, key)) return;
          const name = node.name as string;
          if (declared.has(name)) return;
          const local = locals.get(name);
          if (local !== undefined) {
            // A loop variable holds a value from inside its source.
            mask |= local;
            this.deepReads |= local;
            return;
          }
          if (this.bits.has(name)) {
            field(name, isShallowContext(parent, key));
            return;
          }
          if (this.methods.has(name)) {
            add(this.methodReadMask(name));
            return;
          }
          if (PURE_GLOBALS.has(name) || name.startsWith('__htms')) return;
          everything();
          return;
        }
        case 'MemberExpression': {
          const { root: base, names } = memberChain(node);
          if (base.type === 'ThisExpression') {
            const [first] = names;
            if (first !== null && first !== undefined && this.bits.has(first)) {
              field(first, names.length === 1 && isShallowContext(parent, key));
            } else {
              add(this.thisMemberRead(first ?? null));
            }
          } else if (
            base.type === 'Identifier' &&
            isGlobal(base.name as string)
          ) {
            const name = base.name as string;
            if (
              (!PURE_GLOBALS.has(name) && !name.startsWith('__htms')) ||
              VOLATILE_STATICS.has(`${name}.${names[0]}`)
            ) {
              everything();
              return;
            }
          } else {
            visit(base, node, 'object');
          }
          forEachComputedKey(node, (expression, owner) =>
            visit(expression, owner, 'property')
          );
          return;
        }
        case 'NewExpression': {
          const callee = node.callee as AstNode;
          if (
            callee.type === 'Identifier' &&
            callee.name === 'Date' &&
            (node.arguments as AstNode[]).length === 0
          ) {
            everything();
            return;
          }
          break;
        }
      }
      forEachChild(node, (childKey, child) => visit(child, node, childKey));
    };
    visit(root, null, '');
    return { mask, direct };
  }

  private thisMemberRead(name: string | null): number {
    if (name === null) return ALL_DIRTY;
    if (this.bits.has(name)) return this.fieldReadMask(name);
    if (this.methods.has(name)) return this.methodReadMask(name);
    if (INERT_HELPERS.has(name) || name.startsWith('__htms')) return 0;
    // `$`, `$$` and any other member of the element read DOM state, which
    // renders change.
    return ALL_DIRTY;
  }

  // ---------------------------------------------------------------------
  // Writes

  // Mask a snippet must report after running: nested writes and mutating
  // calls, which no setter sees. Direct assignments to reactive fields are
  // left out because their setters mark them. `locals` maps names declared
  // outside the snippet to the class mask of the objects they may hold
  // (0 for values unrelated to state, `ALL_DIRTY` for unknown ones).
  writeMask(code: string, locals: Masks, asExpression: boolean): number {
    const root = parseSnippet(code, asExpression);
    if (!root) return ALL_DIRTY;
    return this.writeNode(root, new Map(locals));
  }

  methodWriteMask(name: string): number {
    const cached = this.methodWrites.get(name);
    if (cached !== undefined) return cached;
    const method = this.methods.get(name);
    if (method === undefined) return ALL_DIRTY;
    const key = `write:${name}`;
    if (this.inProgress.has(key)) return ALL_DIRTY;
    this.inProgress.add(key);
    // A parameter holds what the component's call sites pass it; a method
    // nothing in the component calls may receive any state object.
    const slots = this.paramSources.get(name);
    const locals = new Map(
      method.params.map((param, index) => [
        param,
        this.paramTaint(slots, index),
      ])
    );
    const mask = this.writeMask(method.body, locals, false);
    this.inProgress.delete(key);
    this.methodWrites.set(name, mask);
    return mask;
  }

  private paramTaint(
    slots: ReadonlyArray<ReadonlySet<string>> | undefined,
    index: number
  ): number {
    if (slots === undefined) return ALL_DIRTY;
    const slot = slots.at(index);
    if (slot === undefined) return 0;
    let mask = 0;
    for (const field of slot) mask |= this.classMask(field);
    return mask;
  }

  private writeNode(root: AstNode, taints: Map<string, number>): number {
    let mask = 0;
    const visit = (node: AstNode): void => {
      if (mask === ALL_DIRTY) return;
      switch (node.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression': {
          // Callback parameters may hold anything.
          const names = new Set<string>();
          for (const param of node.params as AstNode[]) {
            collectPatternNames(param, names);
          }
          for (const name of names) taints.set(name, ALL_DIRTY);
          break;
        }
        case 'CatchClause': {
          const names = new Set<string>();
          collectPatternNames(node.param, names);
          for (const name of names) taints.set(name, 0);
          break;
        }
        case 'ForOfStatement':
        case 'ForInStatement': {
          const taint = this.valueTaint(node.right as AstNode, taints);
          for (const name of loopVariableNames(node.left as AstNode)) {
            taints.set(name, taint);
          }
          break;
        }
        case 'VariableDeclarator': {
          if (!isNode(node.init)) break;
          const names = new Set<string>();
          collectPatternNames(node.id, names);
          const taint = this.valueTaint(node.init, taints);
          for (const name of names) taints.set(name, taint);
          break;
        }
        case 'AssignmentExpression':
          mask |= this.targetWrite(node.left as AstNode, taints, true);
          break;
        case 'UpdateExpression':
          mask |= this.targetWrite(node.argument as AstNode, taints, true);
          break;
        case 'UnaryExpression':
          if (node.operator === 'delete') {
            mask |= this.targetWrite(node.argument as AstNode, taints, false);
          }
          break;
        case 'CallExpression':
          mask |= this.callWrite(node, taints);
          break;
      }
      forEachChild(node, (_key, child) => visit(child));
    };
    visit(root);
    return mask;
  }

  // What a write to `target` must report. A depth-one write to a reactive
  // field goes through its setter; `viaSetter` is false for `delete`, which
  // bypasses setters. A write one level below a field changes the field's
  // own contents; anything further down, or through a value of unknown
  // origin, is deep.
  private targetWrite(
    target: AstNode,
    taints: Masks,
    viaSetter: boolean
  ): number {
    const { root, names } = memberChain(target);
    if (root.type === 'ThisExpression') {
      const [first] = names;
      if (first === null || first === undefined) return ALL_DIRTY;
      if (this.bits.has(first)) {
        if (names.length === 1 && viaSetter && !this.derived.has(first)) {
          return 0;
        }
        return this.fieldWrite(first, names.length > 2);
      }
      // A helper's internals, or a plain property nothing declared. The
      // latter is read as volatile, but only a render re-reads it.
      return ALL_DIRTY;
    }
    if (root.type === 'Identifier') {
      const name = root.name as string;
      const taint = taints.get(name);
      if (taint !== undefined) return names.length === 0 ? 0 : deepen(taint);
      if (this.bits.has(name)) {
        // Unscoped code: a bare field name.
        if (names.length === 0 && viaSetter && !this.derived.has(name)) {
          return 0;
        }
        return this.fieldWrite(name, names.length > 1);
      }
      return 0;
    }
    if (root.type === 'CallExpression') {
      // `this.find(id).done = true` may hand back a state object.
      const { root: calleeRoot } = memberChain(root.callee as AstNode);
      return calleeRoot.type === 'ThisExpression'
        ? ALL_DIRTY
        : deepen(this.valueTaint(root, taints));
    }
    return deepen(this.valueTaint(root, taints));
  }

  private callWrite(node: AstNode, taints: Masks): number {
    const args = node.arguments as AstNode[];
    const { root, names } = memberChain(node.callee as AstNode);
    const method = names.at(-1);
    if (root.type === 'ThisExpression') {
      const [first] = names;
      if (first === null || first === undefined) return ALL_DIRTY;
      if (names.length === 1) {
        // A method reports its own nested writes when it returns, and the
        // state helpers report theirs.
        if (this.methods.has(first) || PATH_HELPERS.has(first)) return 0;
        if (INERT_HELPERS.has(first) || DOM_HELPERS.has(first)) return 0;
        // requestUpdate, other helpers and element methods.
        return ALL_DIRTY;
      }
      if (this.bits.has(first)) {
        return isPureMethod(method)
          ? 0
          : this.fieldWrite(first, names.length > 2);
      }
      return first.startsWith('__htms') ? ALL_DIRTY : 0;
    }
    if (root.type === 'Identifier') {
      const name = root.name as string;
      const taint = taints.get(name);
      if (names.length === 0) {
        if (taint !== undefined) return 0;
        if (this.methods.has(name)) return 0;
        if (PURE_GLOBALS.has(name) || name.startsWith('__htms')) return 0;
        // An unknown function may change the state objects it receives.
        return deepen(this.argumentsTaint(args, taints));
      }
      if (taint !== undefined) return isPureMethod(method) ? 0 : deepen(taint);
      if (this.bits.has(name)) {
        return isPureMethod(method)
          ? 0
          : this.fieldWrite(name, names.length > 1);
      }
      if (PURE_GLOBALS.has(name)) {
        const [first] = args;
        return MUTATING_STATICS.has(`${name}.${method}`) && first
          ? deepen(this.valueTaint(first, taints))
          : 0;
      }
      return deepen(this.argumentsTaint(args, taints));
    }
    return 0;
  }

  private argumentsTaint(args: readonly AstNode[], taints: Masks): number {
    let mask = 0;
    for (const argument of args) mask |= this.valueTaint(argument, taints);
    return mask;
  }

  // Class mask of the state objects an expression's value may be or hold.
  private valueTaint(node: AstNode, taints: Masks): number {
    switch (node.type) {
      case 'Literal':
      case 'TemplateLiteral':
      case 'BinaryExpression':
      case 'UnaryExpression':
      case 'UpdateExpression':
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return 0;
      case 'Identifier': {
        const name = node.name as string;
        const taint = taints.get(name);
        if (taint !== undefined) return taint;
        return this.bits.has(name) ? this.classMask(name) : 0;
      }
      case 'ThisExpression':
        return ALL_DIRTY;
      case 'MemberExpression':
      case 'ChainExpression': {
        const { root, names } = memberChain(node);
        if (root.type === 'ThisExpression') {
          const [first] = names;
          if (first === null || first === undefined) return ALL_DIRTY;
          if (this.bits.has(first)) return this.classMask(first);
          return this.methods.has(first) || INERT_HELPERS.has(first)
            ? 0
            : ALL_DIRTY;
        }
        return this.valueTaint(root, taints);
      }
      case 'CallExpression': {
        const callee = node.callee as AstNode;
        const { root, names } = memberChain(callee);
        if (root.type === 'ThisExpression') {
          const [first] = names;
          if (names.length === 1 && first !== null && first !== undefined) {
            // A method may hand back any state object; helpers do not.
            return INERT_HELPERS.has(first) || DOM_HELPERS.has(first)
              ? 0
              : ALL_DIRTY;
          }
          // `this.rows.filter(...)` hands back rows of `rows`.
          return this.valueTaint(callee, taints);
        }
        return (
          this.valueTaint(root, taints) |
          this.argumentsTaint(node.arguments as AstNode[], taints)
        );
      }
      case 'NewExpression':
        return this.argumentsTaint(node.arguments as AstNode[], taints);
      case 'ArrayExpression': {
        let mask = 0;
        for (const element of node.elements as Array<AstNode | null>) {
          if (element) mask |= this.valueTaint(element, taints);
        }
        return mask;
      }
      case 'ObjectExpression': {
        let mask = 0;
        for (const property of node.properties as AstNode[]) {
          const value =
            property.type === 'SpreadElement'
              ? property.argument
              : property.value;
          if (isNode(value)) mask |= this.valueTaint(value, taints);
        }
        return mask;
      }
      case 'SpreadElement':
      case 'AwaitExpression':
      case 'YieldExpression':
        return isNode(node.argument)
          ? this.valueTaint(node.argument, taints)
          : 0;
      case 'ConditionalExpression':
        return (
          this.valueTaint(node.consequent as AstNode, taints) |
          this.valueTaint(node.alternate as AstNode, taints)
        );
      case 'LogicalExpression':
        return (
          this.valueTaint(node.left as AstNode, taints) |
          this.valueTaint(node.right as AstNode, taints)
        );
      case 'AssignmentExpression':
        return this.valueTaint(node.right as AstNode, taints);
      case 'SequenceExpression': {
        const last = (node.expressions as AstNode[]).at(-1);
        return last ? this.valueTaint(last, taints) : 0;
      }
      default:
        return ALL_DIRTY;
    }
  }
}

// ---------------------------------------------------------------------
// Alias collection over a component

interface MethodSource {
  name: string;
  params: string[];
  body: DirectiveNode[];
}

// Walks the component once and records which fields may share objects:
// every assignment of one field's value to another, including through loop
// variables and method parameters. Methods are walked last, with each
// parameter standing for the fields its call sites pass.
export function collectAliases(
  ir: ComponentIR,
  analyzer: DependencyAnalyzer,
  initialValues: ReadonlyMap<string, string>
): void {
  const callArguments = new Map<string, Array<Set<string>>>();
  const methods: MethodSource[] = [];

  // Records the fields each argument of every call may carry, by callee
  // name, so method parameters can be traced to them.
  const noteCalls = (
    code: string,
    locals: FieldSources,
    asExpression: boolean
  ): void => {
    const root = parseSnippet(code, asExpression);
    if (!root) return;
    const visit = (node: AstNode): void => {
      if (node.type === 'CallExpression') {
        const { root: base, names } = memberChain(node.callee as AstNode);
        const name =
          base.type === 'Identifier' && names.length === 0
            ? (base.name as string)
            : base.type === 'ThisExpression' && names.length === 1
              ? names[0]
              : null;
        if (name !== null) {
          let slots = callArguments.get(name);
          if (!slots) {
            slots = [];
            callArguments.set(name, slots);
          }
          const known = slots;
          (node.arguments as AstNode[]).forEach((argument, index) => {
            const sources = analyzer.fieldsOf(argument, locals);
            const slot = known.at(index);
            if (slot) {
              for (const field of sources) slot.add(field);
            } else {
              known.push(sources);
            }
          });
        }
      }
      forEachChild(node, (_key, child) => visit(child));
    };
    visit(root);
  };

  const statements = (code: string, locals: FieldSources): void => {
    analyzer.aliasStatements(code, locals);
    noteCalls(code, locals, false);
  };

  const withVar = (
    locals: FieldSources,
    name: string | undefined,
    sources: ReadonlySet<string>
  ): FieldSources => {
    if (!name) return locals;
    const next = new Map(locals);
    next.set(name, sources);
    return next;
  };

  const walkNodes = (
    nodes: readonly TemplateNode[] | undefined,
    locals: FieldSources
  ): void => {
    for (const node of nodes ?? []) {
      if (node.type !== 'element') continue;
      for (const binding of node.bindings ?? []) {
        if (binding.kind === 'event') {
          statements(binding.code, withVar(locals, 'event', new Set()));
        }
      }
      for (const child of node.children ?? []) {
        if (child.type === 'directive') walkDirective(child.directive, locals);
        else walkNodes([child], locals);
      }
    }
  };

  const walkBody = (
    template: readonly TemplateNode[],
    directives: readonly DirectiveNode[] | undefined,
    locals: FieldSources
  ): void => {
    walkNodes(template, locals);
    for (const nested of directives ?? []) walkDirective(nested, locals);
  };

  const walkDirective = (
    directive: DirectiveNode,
    locals: FieldSources
  ): void => {
    switch (directive.kind) {
      case 'loop': {
        if (directive.mode === 'array') {
          const sources = analyzer.fieldsIn(directive.source, locals, true);
          const inner = withVar(
            withVar(locals, directive.itemVar, sources),
            directive.indexVar,
            sources
          );
          walkBody(directive.template, directive.directives, inner);
        } else {
          const inner = withVar(locals, directive.indexVar, new Set());
          walkBody(directive.template, directive.directives, inner);
        }
        return;
      }
      case 'keyed-list': {
        const sources = analyzer.fieldsIn(directive.source, locals, true);
        const inner = withVar(
          withVar(locals, directive.itemVar, sources),
          directive.indexVar,
          sources
        );
        walkBody(directive.template, directive.directives, inner);
        return;
      }
      case 'condition':
        walkBody(
          directive.whenTrue.template,
          directive.whenTrue.directives,
          locals
        );
        if (directive.whenFalse) {
          walkBody(
            directive.whenFalse.template,
            directive.whenFalse.directives,
            locals
          );
        }
        return;
      case 'switch':
        for (const switchCase of directive.cases) {
          walkBody(switchCase.template, switchCase.directives, locals);
        }
        if (directive.defaultCase) {
          walkBody(
            directive.defaultCase.template,
            directive.defaultCase.directives,
            locals
          );
        }
        return;
      case 'while':
      case 'append':
        walkBody(directive.template, directive.directives, locals);
        return;
      case 'event': {
        const inner = withVar(locals, 'event', new Set());
        for (const code of directive.body) statements(code, inner);
        for (const nested of directive.directives ?? []) {
          walkDirective(nested, inner);
        }
        return;
      }
      case 'state': {
        const [target] = directive.path;
        if (target === undefined) return;
        const codes = [
          directive.value,
          directive.index,
          ...(directive.values ?? []),
        ];
        for (const code of codes) {
          if (code !== undefined) {
            analyzer.aliasAssignment(target, code, locals);
            noteCalls(code, locals, true);
          }
        }
        return;
      }
      case 'statement':
        statements(directive.code, locals);
        return;
      case 'method':
        methods.push({
          name: directive.name,
          params: directive.params,
          body: directive.body,
        });
        return;
      case 'visibility':
      case 'attribute':
      case 'bind':
      case 'class':
      case 'style':
        return;
    }
  };

  for (const [name, code] of initialValues) {
    analyzer.aliasAssignment(name, code, new Map());
    noteCalls(code, new Map(), true);
  }
  walkNodes(ir.templateNodes, new Map());
  for (const directive of ir.directives) walkDirective(directive, new Map());

  // Parameters take the fields their call sites pass. A method calling
  // another with its own parameter needs the caller's sources first, so
  // the walk repeats until no call site learns a new source.
  let previous = '';
  for (let round = 0; round < 8; round++) {
    const snapshot = JSON.stringify(
      Array.from(callArguments, ([name, slots]) => [
        name,
        slots.map((slot) => Array.from(slot).sort()),
      ])
    );
    if (snapshot === previous) break;
    previous = snapshot;
    for (const method of methods) {
      let locals: FieldSources = new Map();
      const slots = callArguments.get(method.name) ?? [];
      method.params.forEach((param, index) => {
        locals = withVar(locals, param, slots.at(index) ?? new Set());
      });
      for (const directive of method.body) walkDirective(directive, locals);
    }
  }
  analyzer.setParamSources(callArguments);
}
