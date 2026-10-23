import {
  ComponentIR,
  ConditionDirective,
  DirectiveNode,
  EventDirective,
  EventModifiers,
  TemplateBinding,
  TemplateNode,
} from './ir';
import { parseProgram } from '../utils/js-parser';
import { ALL_DIRTY, DEEP_BIT, DependencyAnalyzer } from './dependencies';
import { scopeExpression, scopeStatements } from './scope';
import {
  BOOLEAN_ATTRIBUTES,
  URL_ATTRIBUTES,
  renderEventPreamble,
  resolveWholeAttributeInterpolation,
  serializeTextValue,
} from './template-serializer';
import { isPlainTemplate, templateNodeHtml } from './template-shape';
import {
  SourceComment,
  SourceDocument,
  SourceDocumentFragment,
  SourceElement,
  SourceNode,
  SourceParentNode,
  SourceText,
} from '../source-dom';

// The block renderer compiles a component template into "blocks": a static
// HTML template that is cloned once per instance, the node references the
// block writes to, and an update method that re-evaluates each dynamic
// value and touches the DOM only when that value changed. Lists reconcile
// keyed rows with a longest-increasing-subsequence pass, so a reorder moves
// the fewest nodes. Events bubble to one listener per type on the render
// root instead of one listener per element. Every binding is guarded by the
// mask of fields it reads (see dependencies.ts), so an update evaluates only
// the values a changed field can affect.
//
// Selector-based directives (<event target>, <bind selector>, <toggle> ...)
// are resolved at compile time by replaying the legacy renderer's order of
// operations on a sample DOM. When a selector could match markup that a
// loop or branch creates at runtime, the component falls back to the
// reconciling renderer, which resolves selectors on every render.

export class UnsupportedBlockFeature extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnsupportedBlockFeature';
  }
}

export interface BlockCompileOptions {
  className: string;
  document: SourceDocument;
  componentFields: string[];
  analyzer: DependencyAnalyzer;
  // Statements an <event> directive runs when it fires, with nested
  // directives applied to `eventRootVar`. Must not request a render; the
  // block compiler adds that from the statements' writes.
  renderEventBody: (
    directive: EventDirective,
    eventRootVar: string,
    scopeVars: string[]
  ) => string[];
}

export interface BlockComponentPlan {
  // Class members: template factories, block create/update methods, event
  // handlers and key functions.
  members: string;
  delegatedEvents: string[];
  // Lines that attach window/document/host listeners once per connection.
  globalListeners: string[];
  // Statement directives (effects, prints) run after every render.
  statements: string[];
  hasHandlers: boolean;
  // Fields something rendered reads; a change to any other field needs no
  // render. Every bit when statements run after each render.
  usedMask: number;
}

type Namespace = 'html' | 'svg' | 'mathml';

interface PElement {
  kind: 'element';
  tag: string;
  ns: Namespace;
  attrs: Array<[string, string]>;
  children: PNode[];
  sample: SourceElement;
  local: string | null;
  field: string | null;
  wantLocal: boolean;
  wantField: boolean;
  // Attribute names a render may change; selectors reading them can't be
  // resolved at compile time.
  dynamicAttrs: Set<string>;
  // Conflict keys for values this node's parts write.
  writes: Set<string>;
  classWriter: boolean;
  classToggles: boolean;
  styleWriter: boolean;
  styleToggles: boolean;
  flag: string | null;
  styleFlag: string | null;
  staticClasses: Set<string>;
}

interface PText {
  kind: 'text';
  text: string;
  dynamic: boolean;
  sample: SourceText;
  local: string | null;
  field: string | null;
  wantLocal: boolean;
  wantField: boolean;
}

interface PComment {
  kind: 'comment';
  data: string;
  sample: SourceComment;
  local: string | null;
  field: string | null;
  wantLocal: boolean;
  wantField: boolean;
}

type PNode = PElement | PText | PComment;

interface Container {
  children: PNode[];
  sample: SourceParentNode;
  element: PElement | null;
}

type Scope =
  | { kind: 'fragment'; sample: SourceDocumentFragment }
  | { kind: 'element'; sample: SourceElement; node: PElement };

interface ListSub {
  kind: 'list';
  container: Container;
  start: PComment;
  end: PComment;
  owned: boolean;
  source: string;
  // Fields the source expression reads.
  mask: number;
  body: BlockPlan;
  keyed: boolean;
  dataKey: boolean;
  slot: string;
}

interface CondBranch {
  test: string | null;
  body: BlockPlan;
}

interface CondSub {
  kind: 'cond';
  end: PComment;
  // Evaluated once per update before the branch tests (switch subject).
  prelude: string | null;
  branches: CondBranch[];
  slot: string;
  // Fields the prelude and branch tests read.
  testMask: number;
}

type ValueSpec =
  | { kind: 'text'; node: PText; expr: string; slot: string }
  | {
      kind: 'attr';
      node: PElement;
      name: string;
      expr: string;
      mode: 'string' | 'class' | 'bool' | 'url' | 'directive';
      slot: string;
    }
  | {
      kind: 'toggle';
      node: PElement;
      name: string;
      expr: string;
      slot: string;
      initial: boolean;
    }
  | {
      kind: 'style';
      node: PElement;
      property: string;
      expr: string;
      mode: 'binding' | 'css' | 'property';
      slot: string;
    }
  | { kind: 'show'; node: PElement; expr: string; slot: string }
  | {
      kind: 'prop';
      node: PElement;
      path: string[];
      expr: string;
      live: boolean;
      url: boolean;
      guard: string | null;
      slot: string;
    };

// A value part with the mask of fields its expression reads.
type ValuePart = ValueSpec & { mask: number };

type Part = ValuePart | ListSub | CondSub;

type CreateAction =
  | {
      kind: 'event';
      node: PElement;
      type: string;
      handler: string;
      // False for a handler that never reads the event; the dispatcher
      // then skips exposing currentTarget on it.
      usesEvent: boolean;
      options: string | null;
    }
  | { kind: 'code'; node: PElement; code: (local: string) => string }
  | { kind: 'clear'; node: PElement };

interface BlockVar {
  name: string;
  field: 'x' | 'i';
  // Fields the loop source reads: the variable changes when they do.
  mask: number;
}

interface BlockPlan {
  id: number;
  parent: BlockPlan | null;
  kind: 'root' | 'loop' | 'branch';
  vars: BlockVar[];
  roots: PNode[];
  sample: SourceDocumentFragment;
  parts: Part[];
  creates: CreateAction[];
  slots: number;
  subs: number;
  keyMethod: string | null;
  // keyed-list rows carry their key as data-key on the first element.
  dataKeyExpr: string | null;
  // Fields the block's own expressions read other than through a loop
  // variable: changes to anything else cannot reach a row whose item and
  // index stayed the same.
  direct: number;
  // Loop index variables the block's expressions read.
  indexReads: Set<string>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

// Events that bubble and are handled by one listener on the render root.
const DELEGATED_EVENTS = new Set([
  'beforeinput',
  'click',
  'change',
  'contextmenu',
  'dblclick',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keyup',
  'mousedown',
  'mousemove',
  'mouseout',
  'mouseover',
  'mouseup',
  'pointerdown',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
]);

// Properties compared against the live DOM, so user edits are overwritten
// by the bound state (controlled inputs).
const LIVE_PROPERTIES = new Set([
  'value',
  'checked',
  'selected',
  'selectedIndex',
  'indeterminate',
]);

const GLOBAL_TARGETS = new Map([
  ['window', 'window'],
  ['document', 'document'],
  [':host', 'this'],
  ['host', 'this'],
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(code: string, name: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])`).test(code);
}

function textExpression(expression: string): string {
  return expression.replace(/this\.__htmsToText\(/g, '__htmsS(');
}

// The argument of a text expression that is one `__htmsS(value)` call, so
// updates can compare the raw value and skip converting it to a string.
function rawTextValue(expression: string): string | null {
  if (!expression.startsWith('__htmsS(') || !expression.endsWith(')'))
    return null;
  try {
    const program = parseProgram(expression, 'script');
    const statement = program.body[0];
    if (
      program.body.length === 1 &&
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'CallExpression' &&
      statement.expression.callee.type === 'Identifier' &&
      statement.expression.callee.name === '__htmsS' &&
      statement.expression.arguments.length === 1
    ) {
      const [argument] = statement.expression.arguments;
      return expression.slice(argument.start, argument.end);
    }
  } catch {
    return null;
  }
  return null;
}

export function compileBlockComponent(
  ir: ComponentIR,
  options: BlockCompileOptions
): BlockComponentPlan {
  return new BlockCompiler(options).compile(ir);
}

class BlockCompiler {
  private readonly blocks: BlockPlan[] = [];
  private readonly handlers: string[] = [];
  private readonly delegated = new Set<string>();
  private readonly globals: string[] = [];
  private readonly statements: string[] = [];
  private readonly sampleOwners = new WeakMap<
    SourceNode,
    { node: PElement; block: BlockPlan }
  >();
  private readonly fields: Set<string>;
  private readonly doc: SourceDocument;
  private readonly analyzer: DependencyAnalyzer;
  private readonly blockMasks = new Map<BlockPlan, number>();
  private handlerCount = 0;
  private eventRootCount = 0;

  constructor(private readonly options: BlockCompileOptions) {
    this.fields = new Set(options.componentFields);
    this.doc = options.document;
    this.analyzer = options.analyzer;
  }

  compile(ir: ComponentIR): BlockComponentPlan {
    const root = this.newBlock(null, 'root', []);
    const container = this.blockContainer(root);
    const scope: Scope = { kind: 'fragment', sample: root.sample };
    for (const node of ir.templateNodes) {
      this.buildNode(root, container, node);
    }
    for (const directive of ir.directives) {
      this.buildDirective(root, container, directive, scope);
    }

    const members: string[] = [];
    for (const block of this.blocks) {
      this.finalize(block);
    }
    for (const block of this.blocks) {
      members.push(this.generateBlock(block));
    }
    members.push(...this.handlers);
    // Every binding has been read, so the masks handlers report (which
    // leave out fields no binding can observe) can now be computed.
    this.analyzer.completeReads();

    return {
      members: this.resolveStateMasks(
        this.resolvePlaceholders(members.join('\n'))
      ),
      delegatedEvents: Array.from(this.delegated),
      globalListeners: this.globals,
      statements: this.statements,
      hasHandlers: this.handlerCount > 0,
      usedMask: this.statements.length > 0 ? ALL_DIRTY : this.blockMask(root),
    };
  }

  // ---------------------------------------------------------------------
  // Building the block tree

  private newBlock(
    parent: BlockPlan | null,
    kind: BlockPlan['kind'],
    vars: BlockVar[]
  ): BlockPlan {
    const block: BlockPlan = {
      id: this.blocks.length,
      parent,
      kind,
      vars,
      roots: [],
      sample: this.doc.createDocumentFragment(),
      parts: [],
      creates: [],
      slots: 0,
      subs: 0,
      keyMethod: null,
      dataKeyExpr: null,
      direct: 0,
      indexReads: new Set(),
    };
    this.blocks.push(block);
    return block;
  }

  private blockContainer(block: BlockPlan): Container {
    return { children: block.roots, sample: block.sample, element: null };
  }

  private slot(block: BlockPlan): string {
    return `v${block.slots++}`;
  }

  // Loop variables visible in a block, innermost first.
  private visibleVars(block: BlockPlan): Array<{
    name: string;
    field: 'x' | 'i';
    path: string;
    mask: number;
  }> {
    const seen = new Set<string>();
    const result: Array<{
      name: string;
      field: 'x' | 'i';
      path: string;
      mask: number;
    }> = [];
    let hops = 0;
    for (
      let current: BlockPlan | null = block;
      current;
      current = current.parent
    ) {
      for (const variable of current.vars) {
        if (seen.has(variable.name)) continue;
        seen.add(variable.name);
        result.push({
          name: variable.name,
          field: variable.field,
          path: `${'.P'.repeat(hops)}.${variable.field}`,
          mask: variable.mask,
        });
      }
      hops += 1;
    }
    return result;
  }

  private localNames(block: BlockPlan): string[] {
    return this.visibleVars(block).map((variable) => variable.name);
  }

  // Mask of the fields `code` reads inside `block`, where loop variables
  // stand for the fields their list reads.
  private readMask(
    block: BlockPlan,
    code: string,
    asExpression = true
  ): number {
    const locals = new Map<string, number>();
    const visible = this.visibleVars(block);
    for (const variable of visible) {
      locals.set(variable.name, variable.mask);
    }
    const { mask, direct } = this.analyzer.readMasks(
      code,
      locals,
      asExpression
    );
    block.direct |= direct;
    for (const variable of visible) {
      if (variable.field === 'i' && mentions(code, variable.name)) {
        block.indexReads.add(variable.name);
      }
    }
    return mask;
  }

  // Mask a handler in `block` reports after running `code`: the alias
  // classes of nested writes. Loop variables may hold objects of the fields
  // their list reads; `event` and the names in `inert` hold DOM values.
  private writeMask(
    block: BlockPlan,
    code: string,
    inert: readonly string[]
  ): number {
    const locals = new Map<string, number>();
    for (const variable of this.visibleVars(block)) {
      locals.set(variable.name, this.analyzer.expand(variable.mask));
    }
    locals.set('event', 0);
    for (const name of inert) locals.set(name, 0);
    return this.analyzer.writeMask(code, locals, false);
  }

  // The line that reports a handler body's nested writes. Its mask depends
  // on which fields bindings read, so it is a placeholder until every
  // binding has been compiled; a body with nothing to report loses the line.
  private readonly pendingNotifies: Array<{
    block: BlockPlan;
    code: string;
    inert: readonly string[];
  }> = [];

  private notifyLines(
    block: BlockPlan,
    body: readonly string[],
    inert: readonly string[] = []
  ): string[] {
    const id = this.pendingNotifies.length;
    this.pendingNotifies.push({ block, code: body.join('\n'), inert });
    return [`this.__htmsNotifyStateChange(@@notify:${id}@@);`];
  }

  // Fields read directly (not through a loop variable) anywhere in a block,
  // including its nested lists and branches.
  private blockDirect(block: BlockPlan): number {
    let mask = block.direct;
    for (const part of block.parts) {
      if (part.kind === 'list') {
        mask |= this.blockDirect(part.body);
      } else if (part.kind === 'cond') {
        for (const branch of part.branches) {
          mask |= this.blockDirect(branch.body);
        }
      }
    }
    return mask;
  }

  // Whether anything in a loop body renders the index variable `name`.
  private blockReadsIndex(block: BlockPlan, name: string): boolean {
    if (block.indexReads.has(name)) return true;
    for (const part of block.parts) {
      if (part.kind === 'list') {
        if (this.blockReadsIndex(part.body, name)) return true;
      } else if (part.kind === 'cond') {
        for (const branch of part.branches) {
          if (this.blockReadsIndex(branch.body, name)) return true;
        }
      }
    }
    return false;
  }

  // Fields whose change can affect anything a block renders, including its
  // nested lists and branches.
  private blockMask(block: BlockPlan): number {
    const cached = this.blockMasks.get(block);
    if (cached !== undefined) return cached;
    let mask = 0;
    for (const part of block.parts) {
      if (part.kind === 'list') {
        mask |= part.mask | this.blockMask(part.body);
      } else if (part.kind === 'cond') {
        mask |= part.testMask;
        for (const branch of part.branches) mask |= this.blockMask(branch.body);
      } else {
        mask |= part.mask;
      }
    }
    this.blockMasks.set(block, mask);
    return mask;
  }

  // `const row = $$b.x;` for every loop variable the code reads.
  private declareLocals(
    block: BlockPlan,
    code: string,
    base: string
  ): string[] {
    return this.visibleVars(block)
      .filter((variable) => mentions(code, variable.name))
      .map((variable) => `const ${variable.name} = ${base}${variable.path};`);
  }

  private appendNode(container: Container, node: PNode): void {
    container.children.push(node);
    container.sample.appendChild(node.sample);
  }

  private addComment(container: Container, data: string): PComment {
    const comment: PComment = {
      kind: 'comment',
      data,
      sample: this.doc.createComment(data),
      local: null,
      field: null,
      wantLocal: false,
      wantField: false,
    };
    this.appendNode(container, comment);
    return comment;
  }

  private addText(container: Container, text: PText): void {
    const previous = container.children[container.children.length - 1];
    if (previous?.kind === 'text') {
      // Adjacent text nodes would merge when the template is parsed.
      this.addComment(container, '');
    }
    this.appendNode(container, text);
  }

  private buildNode(
    block: BlockPlan,
    container: Container,
    node: TemplateNode
  ): void {
    if (node.type === 'text') {
      const value = node.textContent ?? '';
      const expression = serializeTextValue(
        value,
        this.localNames(block),
        Array.from(this.fields)
      );
      const dynamic = expression !== JSON.stringify(value);
      const text: PText = {
        kind: 'text',
        text: value,
        dynamic,
        sample: this.doc.createTextNode(dynamic ? ' ' : value),
        local: null,
        field: null,
        wantLocal: false,
        wantField: false,
      };
      this.addText(container, text);
      if (dynamic) {
        const expr = textExpression(expression);
        block.parts.push({
          kind: 'text',
          node: text,
          expr,
          slot: this.slot(block),
          mask: this.readMask(block, expr),
        });
      }
      return;
    }

    const condition = node.bindings?.find((binding) => binding.kind === 'if');
    if (condition) {
      const rest: TemplateNode = {
        ...node,
        bindings: node.bindings?.filter((binding) => binding !== condition),
      };
      const sub = this.addCondition(block, container, null, 0);
      const branch = this.newBlock(block, 'branch', []);
      this.buildNode(branch, this.blockContainer(branch), rest);
      const test = scopeExpression(
        condition.expression,
        this.fields,
        this.localNames(block)
      );
      sub.testMask |= this.readMask(block, test);
      sub.branches.push({ test, body: branch });
      this.mountSample(branch, sub.end);
      return;
    }

    this.buildElement(block, container, node);
  }

  private createSampleElement(tag: string, ns: Namespace): SourceElement {
    if (ns === 'svg') return this.doc.createElementNS(SVG_NS, tag);
    if (ns === 'mathml') return this.doc.createElementNS(MATHML_NS, tag);
    return this.doc.createElement(tag);
  }

  private buildElement(
    block: BlockPlan,
    container: Container,
    node: TemplateNode
  ): void {
    const tag = node.tagName ?? 'div';
    const ns = node.namespace ?? 'html';
    const element: PElement = {
      kind: 'element',
      tag,
      ns,
      attrs: [],
      children: [],
      sample: this.createSampleElement(tag, ns),
      local: null,
      field: null,
      wantLocal: false,
      wantField: false,
      dynamicAttrs: new Set(),
      writes: new Set(),
      classWriter: false,
      classToggles: false,
      styleWriter: false,
      styleToggles: false,
      flag: null,
      styleFlag: null,
      staticClasses: new Set(),
    };
    this.sampleOwners.set(element.sample, { node: element, block });
    const locals = this.localNames(block);
    const fields = Array.from(this.fields);

    for (const [name, value] of Object.entries(node.attributes ?? {})) {
      const lower = name.toLowerCase();
      if (BOOLEAN_ATTRIBUTES.has(lower)) {
        const toggle = resolveWholeAttributeInterpolation(
          value,
          locals,
          fields
        );
        if (toggle) {
          this.addValuePart(block, element, `attr:${lower}`, {
            kind: 'attr',
            node: element,
            name,
            expr: toggle,
            mode: 'bool',
            slot: this.slot(block),
          });
          element.dynamicAttrs.add(lower);
          continue;
        }
      }
      const serialized = serializeTextValue(value, locals, fields);
      if (serialized === JSON.stringify(value)) {
        element.attrs.push([name, value]);
        element.sample.setAttribute(name, value);
        if (lower === 'class') {
          for (const className of value.split(/\s+/).filter(Boolean)) {
            element.staticClasses.add(className);
          }
        }
        continue;
      }
      element.dynamicAttrs.add(lower);
      const isClass = lower === 'class' && ns === 'html';
      const mode = URL_ATTRIBUTES.has(lower)
        ? 'url'
        : isClass
          ? 'class'
          : 'string';
      if (lower === 'class') element.classWriter = true;
      if (lower === 'style') element.styleWriter = true;
      this.addValuePart(block, element, `attr:${lower}`, {
        kind: 'attr',
        node: element,
        name,
        expr: textExpression(serialized),
        mode,
        slot: this.slot(block),
      });
    }

    const bindings = node.bindings ?? [];
    for (const binding of bindings) {
      if (binding.kind === 'event') {
        const body = scopeStatements(binding.code, this.fields, [
          ...locals,
          'event',
        ]).replace(/;?\s*$/, ';');
        this.addHandler(block, element, binding.eventType, binding.modifiers, [
          body,
          ...this.notifyLines(block, [body]),
        ]);
      }
    }

    const elementContainer: Container = {
      children: element.children,
      sample:
        ns === 'html' && tag === 'template'
          ? ((element.sample as SourceElement)
              .content as SourceDocumentFragment)
          : element.sample,
      element,
    };
    const partsBefore = block.parts.length;
    const blocksBefore = this.blocks.length;
    for (const child of node.children ?? []) {
      if (child.type === 'directive') {
        this.buildDirective(block, elementContainer, child.directive, {
          kind: 'element',
          sample: element.sample,
          node: element,
        });
      } else {
        this.buildNode(block, elementContainer, child);
      }
    }
    if (
      ns === 'html' &&
      tag === 'template' &&
      (block.parts.length !== partsBefore ||
        this.blocks.length !== blocksBefore)
    ) {
      throw new UnsupportedBlockFeature('dynamic content inside <template>');
    }

    for (const binding of bindings) {
      this.addPropertyBinding(block, element, binding);
    }

    this.appendNode(container, element);
  }

  private addPropertyBinding(
    block: BlockPlan,
    element: PElement,
    binding: TemplateBinding
  ): void {
    const scoped = (expression: string): string =>
      scopeExpression(expression, this.fields, this.localNames(block));
    if (binding.kind === 'class') {
      element.dynamicAttrs.add('class');
      element.classToggles = true;
      this.addValuePart(block, element, `class:${binding.className}`, {
        kind: 'toggle',
        node: element,
        name: binding.className,
        expr: scoped(binding.expression),
        slot: this.slot(block),
        initial: element.staticClasses.has(binding.className),
      });
      return;
    }
    if (binding.kind === 'style') {
      element.dynamicAttrs.add('style');
      element.styleToggles = true;
      this.addValuePart(block, element, `style:${binding.property}`, {
        kind: 'style',
        node: element,
        property: binding.property,
        expr: scoped(binding.expression),
        mode: 'binding',
        slot: this.slot(block),
      });
      return;
    }
    if (binding.kind !== 'model') {
      return;
    }
    const target = scoped(binding.path);
    const read =
      binding.property === 'value'
        ? `(${target} == null ? '' : ${target})`
        : target;
    this.addValuePart(block, element, `prop:${binding.property}`, {
      kind: 'prop',
      node: element,
      path: [binding.property],
      expr: read,
      live: true,
      url: false,
      guard: null,
      slot: this.slot(block),
    });
    const source = binding.numeric
      ? `(event.currentTarget.value === '' ? null : Number(event.currentTarget.value))`
      : `event.currentTarget[${JSON.stringify(binding.property)}]`;
    const assignment = `${target} = ${source};`;
    this.addHandler(block, element, binding.eventType, {}, [
      assignment,
      ...this.notifyLines(block, [assignment]),
    ]);
  }

  private addValuePart(
    block: BlockPlan,
    element: PElement,
    writeKey: string,
    spec: ValueSpec
  ): void {
    if (element.writes.has(writeKey)) {
      throw new UnsupportedBlockFeature(`conflicting writes to ${writeKey}`);
    }
    element.writes.add(writeKey);
    // A live property is compared with the DOM on every update, so user
    // edits never outlive the state they contradict.
    const mask =
      spec.kind === 'prop' && spec.live
        ? ALL_DIRTY
        : this.readMask(block, spec.expr);
    block.parts.push({ ...spec, mask });
  }

  // Adds a handler method and attaches it to `element` when the block is
  // created: through the delegated root listener when the event bubbles,
  // directly otherwise.
  private addHandler(
    block: BlockPlan,
    element: PElement,
    eventType: string,
    modifiers: EventModifiers,
    body: string[],
    eventRoot?: { variable: string; expression: (base: string) => string }
  ): void {
    const { name, usesEvent } = this.createHandlerMethod(
      block,
      modifiers,
      body,
      eventRoot
    );
    const direct =
      !DELEGATED_EVENTS.has(eventType) ||
      modifiers.capture === true ||
      modifiers.passive === true;
    if (direct) {
      const entries: string[] = [];
      if (modifiers.once) entries.push('once: true');
      if (modifiers.passive) entries.push('passive: true');
      if (modifiers.capture) entries.push('capture: true');
      block.creates.push({
        kind: 'event',
        node: element,
        type: eventType,
        handler: name,
        usesEvent,
        options: entries.length > 0 ? `{ ${entries.join(', ')} }` : null,
      });
    } else {
      this.delegated.add(eventType);
      block.creates.push({
        kind: 'event',
        node: element,
        type: eventType,
        handler: name,
        usesEvent,
        options: null,
      });
    }
    element.wantLocal = true;
  }

  // A handler takes the event only when something in it reads `event`;
  // the dispatcher then skips patching currentTarget for the others.
  private createHandlerMethod(
    block: BlockPlan,
    modifiers: EventModifiers,
    body: string[],
    eventRoot?: { variable: string; expression: (base: string) => string }
  ): { name: string; usesEvent: boolean } {
    const name = `__htmsH${this.handlerCount++}`;
    const listenerId = JSON.stringify(name);
    const run = eventRoot
      ? [
          `const ${eventRoot.variable} = ${eventRoot.expression('$$b')};`,
          ...body,
        ]
      : body;
    const lines = renderEventPreamble(modifiers, listenerId, '    ');
    if (modifiers.debounceMs !== undefined) {
      lines.push(
        `    this.__htmsDebounce(event, ${listenerId}, ${modifiers.debounceMs}, (event) => {`,
        ...run.map((line) => `      ${line}`),
        '    });'
      );
    } else {
      lines.push(...run.map((line) => `    ${line}`));
    }
    const code = lines.join('\n');
    const locals = this.declareLocals(block, code, '$$b').map(
      (line) => `    ${line}`
    );
    const usesEvent = mentions(code, 'event');
    this.handlers.push(
      `  ${name}(${usesEvent ? 'event, ' : ''}$$b) {\n${[...locals, code].join('\n')}\n  }\n`
    );
    return { name, usesEvent };
  }

  private addCondition(
    block: BlockPlan,
    container: Container,
    prelude: string | null,
    testMask: number
  ): CondSub {
    this.addComment(container, '[');
    const end = this.addComment(container, ']');
    const sub: CondSub = {
      kind: 'cond',
      end,
      prelude,
      branches: [],
      slot: `C${block.subs++}`,
      testMask,
    };
    block.parts.push(sub);
    return sub;
  }

  // Places a sub-block's sample content before its end marker so later
  // selector resolution in the parent sees it (as dynamic content).
  private mountSample(sub: BlockPlan, end: PComment): void {
    const parent = end.sample.parentNode;
    if (parent) {
      parent.insertBefore(sub.sample, end.sample);
    }
  }

  private fillBlock(
    block: BlockPlan,
    template: TemplateNode[],
    directives: DirectiveNode[] | undefined
  ): void {
    const container = this.blockContainer(block);
    for (const node of template) {
      this.buildNode(block, container, node);
    }
    const scope: Scope = { kind: 'fragment', sample: block.sample };
    for (const directive of directives ?? []) {
      this.buildDirective(block, container, directive, scope);
    }
  }

  private buildDirective(
    block: BlockPlan,
    container: Container,
    directive: DirectiveNode,
    scope: Scope
  ): void {
    switch (directive.kind) {
      case 'loop':
        this.buildLoop(block, container, directive);
        return;
      case 'condition':
        this.buildCondition(block, container, directive);
        return;
      case 'switch': {
        const subject = `$$s${block.subs}`;
        const sub = this.addCondition(
          block,
          container,
          `const ${subject} = ${directive.expression};`,
          this.readMask(block, directive.expression)
        );
        for (const switchCase of directive.cases) {
          const branch = this.newBlock(block, 'branch', []);
          this.fillBlock(branch, switchCase.template, switchCase.directives);
          sub.testMask |= this.readMask(block, switchCase.value);
          sub.branches.push({
            test: `${subject} === ${switchCase.value}`,
            body: branch,
          });
          this.mountSample(branch, sub.end);
        }
        if (directive.defaultCase) {
          const branch = this.newBlock(block, 'branch', []);
          this.fillBlock(
            branch,
            directive.defaultCase.template,
            directive.defaultCase.directives
          );
          sub.branches.push({ test: null, body: branch });
          this.mountSample(branch, sub.end);
        }
        return;
      }
      case 'keyed-list': {
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          const targetContainer = this.elementContainer(target);
          this.buildList(block, targetContainer, {
            source: directive.source,
            itemVar: directive.itemVar,
            indexVar: directive.indexVar,
            key: directive.key,
            dataKey: true,
            template: directive.template,
            directives: directive.directives,
            range: false,
          });
        }
        return;
      }
      case 'append': {
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          const sub = this.addCondition(
            block,
            this.elementContainer(target),
            null,
            0
          );
          const branch = this.newBlock(block, 'branch', []);
          this.fillBlock(branch, directive.template, directive.directives);
          sub.branches.push({ test: null, body: branch });
          this.mountSample(branch, sub.end);
        }
        return;
      }
      case 'event':
        this.buildEventDirective(block, directive, scope);
        return;
      case 'visibility':
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          target.dynamicAttrs.add('style');
          target.styleToggles = true;
          this.addValuePart(block, target, 'style:display', {
            kind: 'show',
            node: target,
            expr: directive.condition,
            slot: this.slot(block),
          });
        }
        return;
      case 'attribute':
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          if (directive.target === 'attribute') {
            const lower = directive.name.toLowerCase();
            target.dynamicAttrs.add(lower);
            if (lower === 'class') target.classWriter = true;
            if (lower === 'style') target.styleWriter = true;
            this.addValuePart(block, target, `attr:${lower}`, {
              kind: 'attr',
              node: target,
              name: directive.name,
              expr: directive.value,
              mode: 'directive',
              slot: this.slot(block),
            });
          } else {
            const path = directive.path ?? [directive.name];
            this.addValuePart(block, target, `prop:${path.join('.')}`, {
              kind: 'prop',
              node: target,
              path,
              expr: directive.value,
              live: path.length === 1 && LIVE_PROPERTIES.has(path[0]),
              url: URL_ATTRIBUTES.has(path[0].toLowerCase()),
              guard: null,
              slot: this.slot(block),
            });
          }
        }
        return;
      case 'bind':
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          this.addValuePart(block, target, `prop:${directive.property}`, {
            kind: 'prop',
            node: target,
            path: [directive.property],
            expr: directive.expression,
            live: LIVE_PROPERTIES.has(directive.property),
            url: false,
            guard: `BIND evaluation failed for ${directive.selector}`,
            slot: this.slot(block),
          });
        }
        return;
      case 'class':
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          if (directive.condition) {
            target.dynamicAttrs.add('class');
            target.classToggles = true;
            for (const className of directive.classNames) {
              this.addValuePart(block, target, `class:${className}`, {
                kind: 'toggle',
                node: target,
                name: className,
                expr: directive.condition,
                slot: this.slot(block),
                initial: target.staticClasses.has(className),
              });
            }
          } else {
            // Without a condition the change applies to freshly rendered
            // markup, so it is part of the block's initial state.
            const method = directive.action;
            const classList = target.sample.classList;
            for (const className of directive.classNames) {
              if (method === 'add') classList.add(className);
              else if (method === 'remove') classList.remove(className);
              else classList.toggle(className);
            }
            const names = directive.classNames
              .map((className) => JSON.stringify(className))
              .join(', ');
            block.creates.push({
              kind: 'code',
              node: target,
              code: (local) =>
                method === 'toggle'
                  ? `for (const $$c of [${names}]) ${local}.classList.toggle($$c);`
                  : `${local}.classList.${method}(${names});`,
            });
            target.wantLocal = true;
          }
        }
        return;
      case 'style':
        for (const target of this.resolveTargets(
          block,
          scope,
          directive.selector
        )) {
          target.dynamicAttrs.add('style');
          target.styleToggles = true;
          this.addValuePart(block, target, `style:${directive.property}`, {
            kind: 'style',
            node: target,
            property: directive.property,
            expr: directive.value,
            mode: directive.mode === 'css' ? 'css' : 'property',
            slot: this.slot(block),
          });
        }
        return;
      case 'state':
        if (directive.mode === 'init' || directive.mode === 'derive') {
          // Hoisted to the start of render().
          return;
        }
        throw new UnsupportedBlockFeature('state change during render');
      case 'statement':
        if (block.kind !== 'root') {
          throw new UnsupportedBlockFeature(
            'statement inside a loop or branch'
          );
        }
        this.statements.push(...directive.code.split('\n'));
        return;
      case 'method':
        return;
      case 'while':
        throw new UnsupportedBlockFeature('<while> in a template');
    }
  }

  private elementContainer(element: PElement): Container {
    return {
      children: element.children,
      sample: element.sample,
      element,
    };
  }

  private buildCondition(
    block: BlockPlan,
    container: Container,
    directive: ConditionDirective
  ): void {
    const sub = this.addCondition(block, container, null, 0);
    // Flatten else-if chains: whenFalse holding only another condition.
    let current: ConditionDirective | null = directive;
    while (current) {
      const branch = this.newBlock(block, 'branch', []);
      this.fillBlock(
        branch,
        current.whenTrue.template,
        current.whenTrue.directives
      );
      sub.testMask |= this.readMask(block, current.condition);
      sub.branches.push({ test: current.condition, body: branch });
      this.mountSample(branch, sub.end);
      const otherwise: ConditionDirective['whenFalse'] = current.whenFalse;
      current = null;
      if (!otherwise) break;
      const nested: DirectiveNode[] = otherwise.directives ?? [];
      if (
        otherwise.template.length === 0 &&
        nested.length === 1 &&
        nested[0].kind === 'condition'
      ) {
        current = nested[0];
        continue;
      }
      const elseBranch = this.newBlock(block, 'branch', []);
      this.fillBlock(elseBranch, otherwise.template, otherwise.directives);
      sub.branches.push({ test: null, body: elseBranch });
      this.mountSample(elseBranch, sub.end);
    }
  }

  private buildLoop(
    block: BlockPlan,
    container: Container,
    directive: Extract<DirectiveNode, { kind: 'loop' }>
  ): void {
    if (directive.mode === 'array') {
      this.buildList(block, container, {
        source: directive.source,
        itemVar: directive.itemVar,
        indexVar: directive.indexVar,
        key: directive.key,
        dataKey: false,
        template: directive.template,
        directives: directive.directives,
        range: false,
      });
    } else {
      this.buildList(block, container, {
        source: `__htmsRange(${directive.count})`,
        itemVar: directive.indexVar,
        indexVar: undefined,
        key: undefined,
        dataKey: false,
        template: directive.template,
        directives: directive.directives,
        range: true,
      });
    }
  }

  private buildList(
    block: BlockPlan,
    container: Container,
    list: {
      source: string;
      itemVar: string;
      indexVar: string | undefined;
      key: string | undefined;
      dataKey: boolean;
      template: TemplateNode[];
      directives: DirectiveNode[] | undefined;
      range: boolean;
    }
  ): void {
    const start = this.addComment(container, '[');
    const end = this.addComment(container, ']');
    const mask = this.readMask(block, list.source);
    const vars: BlockVar[] = [{ name: list.itemVar, field: 'x', mask }];
    if (list.indexVar && list.indexVar !== list.itemVar) {
      vars.push({ name: list.indexVar, field: 'i', mask });
    }
    const body = this.newBlock(block, 'loop', vars);
    const sub: ListSub = {
      kind: 'list',
      container,
      start,
      end,
      owned: false,
      source: list.source,
      mask,
      body,
      keyed: !!list.key,
      dataKey: list.dataKey,
      slot: `L${block.subs++}`,
    };
    block.parts.push(sub);

    if (list.dataKey) {
      // <keyedlist> scopes its item directives to the row's first element.
      const content = this.blockContainer(body);
      for (const node of list.template) {
        this.buildNode(body, content, node);
      }
      const first = body.roots.find(
        (node): node is PElement => node.kind === 'element'
      );
      if (first && list.directives) {
        for (const directive of list.directives) {
          this.buildDirective(body, this.elementContainer(first), directive, {
            kind: 'element',
            sample: first.sample,
            node: first,
          });
        }
      }
      if (first && list.key) {
        body.dataKeyExpr = list.key;
        first.wantLocal = true;
        first.dynamicAttrs.add('data-key');
      }
    } else {
      this.fillBlock(body, list.template, list.directives);
    }
    if (list.key) {
      body.keyMethod = `__htmsK${body.id}`;
      this.keyExpressions.set(body, list.key);
    }
    this.mountSample(body, end);
  }

  private readonly keyExpressions = new Map<BlockPlan, string>();

  private buildEventDirective(
    block: BlockPlan,
    directive: EventDirective,
    scope: Scope
  ): void {
    const eventRootVar = `_eventRoot${this.eventRootCount++}`;
    const statements = this.options.renderEventBody(
      directive,
      eventRootVar,
      this.localNames(block)
    );
    const body = [
      ...statements,
      ...this.notifyLines(block, statements, [eventRootVar]),
    ];
    const modifiers = directive.modifiers ?? {};
    const global = GLOBAL_TARGETS.get(directive.selector.trim());
    if (global) {
      if (block.kind !== 'root') {
        throw new UnsupportedBlockFeature(
          'global event inside a loop or branch'
        );
      }
      const { name, usesEvent } = this.createHandlerMethod(
        block,
        modifiers,
        body,
        {
          variable: eventRootVar,
          expression: () => '(this.__htmsRoot || this)',
        }
      );
      const entries: string[] = [];
      if (modifiers.once) entries.push('once: true');
      if (modifiers.passive) entries.push('passive: true');
      if (modifiers.capture) entries.push('capture: true');
      const options = entries.length > 0 ? `, { ${entries.join(', ')} }` : '';
      const listener = usesEvent
        ? `(event) => this.${name}(event, this.__htmsBlock)`
        : `() => this.${name}(this.__htmsBlock)`;
      this.globals.push(
        `if (typeof window !== 'undefined') { this.__htmsListen(${global}, ${JSON.stringify(directive.eventType)}, ${listener}${options}); }`
      );
      return;
    }
    const scopeNode = scope.kind === 'element' ? scope.node : null;
    if (scopeNode) {
      scopeNode.wantField = true;
    }
    for (const target of this.resolveTargets(
      block,
      scope,
      directive.selector
    )) {
      this.addHandler(block, target, directive.eventType, modifiers, body, {
        variable: eventRootVar,
        // An element-scoped <event> works on that element; a fragment-scoped
        // one on the whole render root.
        expression: (base) =>
          scopeNode
            ? `${base}.${this.fieldName(scopeNode)}`
            : '(this.__htmsRoot || this)',
      });
    }
  }

  // Field names are assigned after the block is complete, so a handler
  // refers to its scope element through a placeholder resolved on output.
  private fieldName(node: PElement): string {
    return `@@field:${this.placeholderId(node)}@@`;
  }

  private readonly placeholders = new Map<PElement, number>();
  private readonly placeholderNodes: PElement[] = [];

  private placeholderId(node: PElement): number {
    let id = this.placeholders.get(node);
    if (id === undefined) {
      id = this.placeholderNodes.length;
      this.placeholders.set(node, id);
      this.placeholderNodes.push(node);
    }
    return id;
  }

  private resolveTargets(
    block: BlockPlan,
    scope: Scope,
    selector: string
  ): PElement[] {
    const trimmed = selector.trim();
    if (/[:+~]/.test(trimmed)) {
      throw new UnsupportedBlockFeature(
        `selector "${trimmed}" depends on runtime state`
      );
    }
    let matches: SourceElement[];
    try {
      matches = Array.from(scope.sample.querySelectorAll(trimmed));
    } catch {
      throw new UnsupportedBlockFeature(`invalid selector "${trimmed}"`);
    }

    const referenced = new Set<string>();
    if (trimmed.includes('#')) referenced.add('id');
    if (/\.[A-Za-z_-]/.test(trimmed)) referenced.add('class');
    for (const match of trimmed.matchAll(/\[\s*([^\s~|^$*=\]]+)/g)) {
      referenced.add(match[1].toLowerCase());
    }
    if (referenced.size > 0) {
      for (const candidate of Array.from(scope.sample.querySelectorAll('*'))) {
        const owner = this.sampleOwners.get(candidate);
        if (!owner) continue;
        for (const name of referenced) {
          if (owner.node.dynamicAttrs.has(name)) {
            throw new UnsupportedBlockFeature(
              `selector "${trimmed}" reads a dynamic attribute`
            );
          }
        }
      }
    }

    return matches.map((match) => {
      const owner = this.sampleOwners.get(match);
      if (!owner || owner.block !== block) {
        throw new UnsupportedBlockFeature(
          `selector "${trimmed}" matches markup rendered by a loop or branch`
        );
      }
      return owner.node;
    });
  }

  // ---------------------------------------------------------------------
  // Finalizing: ownership, references, parse validation

  private finalize(block: BlockPlan): void {
    // A class (or style) attribute write replaces toggled classes, so the
    // toggles re-apply after it. That needs the write to come first.
    const toggled = new Set<string>();
    for (const part of block.parts) {
      if (part.kind === 'toggle')
        toggled.add(`${this.placeholderId(part.node)}:class`);
      if (part.kind === 'style' || part.kind === 'show') {
        toggled.add(`${this.placeholderId(part.node)}:style`);
      }
      if (part.kind === 'attr') {
        const lower = part.name.toLowerCase();
        if (
          (lower === 'class' || lower === 'style') &&
          toggled.has(`${this.placeholderId(part.node)}:${lower}`)
        ) {
          throw new UnsupportedBlockFeature(
            `${lower} attribute written after its toggles`
          );
        }
      }
    }
    for (const part of block.parts) {
      if (part.kind === 'list') {
        const { container, start, end } = part;
        const owner = container.element;
        if (
          owner &&
          !(owner.ns === 'html' && owner.tag === 'template') &&
          container.children.length === 2 &&
          container.children[0] === start &&
          container.children[1] === end
        ) {
          // The list is the element's only content: no markers, and a clear
          // can drop every row with one textContent write.
          part.owned = true;
          container.children.length = 0;
          owner.wantField = true;
        } else {
          end.wantField = true;
        }
        continue;
      }
      if (part.kind === 'cond') {
        part.end.wantField = true;
        continue;
      }
      if (part.kind === 'text') {
        part.node.wantField = true;
        continue;
      }
      part.node.wantField = true;
      if (part.kind === 'toggle' || part.kind === 'attr') {
        const node = part.node;
        if (node.classWriter && node.classToggles) node.flag = '$$f';
      }
      if (
        part.kind === 'style' ||
        part.kind === 'show' ||
        part.kind === 'attr'
      ) {
        const node = part.node;
        if (node.styleWriter && node.styleToggles) node.styleFlag = '$$g';
      }
    }
    for (const action of block.creates) {
      action.node.wantLocal = true;
    }
    if (block.roots.length === 0) {
      // Every block needs a first and last node to insert and move.
      this.addComment(this.blockContainer(block), '');
    }
    this.validateTemplate(block);
  }

  // The parse context a block's roots need: <circle> only parses as SVG
  // inside an <svg>, while <svg> and <math> themselves parse anywhere.
  private templateNamespace(block: BlockPlan): Namespace {
    const namespaces = new Set(
      block.roots
        .filter(
          (node): node is PElement =>
            node.kind === 'element' &&
            !(node.ns === 'svg' && node.tag === 'svg') &&
            !(node.ns === 'mathml' && node.tag === 'math')
        )
        .map((node) => node.ns)
    );
    if (namespaces.size > 1) {
      throw new UnsupportedBlockFeature('mixed namespaces at a block root');
    }
    return namespaces.values().next().value ?? 'html';
  }

  private templateHtml(block: BlockPlan): string {
    return block.roots.map((node) => templateNodeHtml(node, null)).join('');
  }

  // Parses the generated template and checks it produces exactly the
  // planned node structure. HTML parsing can move nodes (a <div> inside a
  // <p>, text inside a <table>); such templates use the legacy renderer.
  // Templates built only from markup the parser never restructures skip
  // the parse.
  private validateTemplate(block: BlockPlan): void {
    const ns = this.templateNamespace(block);
    if (ns === 'html' && isPlainTemplate(block.roots)) return;
    const template = this.doc.createElement('template');
    const html = this.templateHtml(block);
    template.innerHTML =
      ns === 'svg'
        ? `<svg>${html}</svg>`
        : ns === 'mathml'
          ? `<math>${html}</math>`
          : html;
    const content = template.content as SourceDocumentFragment;
    let parsed: SourceNode = content;
    if (ns !== 'html') {
      const wrapper = content.firstChild;
      if (!wrapper) throw new UnsupportedBlockFeature('empty foreign template');
      parsed = wrapper;
    }
    if (!this.sameStructure(parsed, block.roots)) {
      throw new UnsupportedBlockFeature(
        'template markup is restructured by the HTML parser'
      );
    }
  }

  private sameStructure(parsed: SourceNode, nodes: PNode[]): boolean {
    const children =
      parsed instanceof SourceParentNode ? Array.from(parsed.childNodes) : [];
    if (children.length !== nodes.length) return false;
    return nodes.every((node, index) => {
      const actual = children.at(index) as SourceNode;
      if (node.kind === 'comment') return actual.nodeType === 8;
      if (node.kind === 'text') {
        return (
          actual.nodeType === 3 &&
          (node.dynamic || (actual as SourceText).data === node.text)
        );
      }
      if (actual.nodeType !== 1) return false;
      const element = actual as SourceElement;
      const namespace =
        node.ns === 'svg' ? SVG_NS : node.ns === 'mathml' ? MATHML_NS : HTML_NS;
      if (
        element.localName !== node.tag ||
        element.namespaceURI !== namespace
      ) {
        return false;
      }
      if (node.ns === 'html' && node.tag === 'template') {
        return true;
      }
      return this.sameStructure(element, node.children);
    });
  }

  // ---------------------------------------------------------------------
  // Code generation

  private generateBlock(block: BlockPlan): string {
    const counter = { value: 0 };
    const nameNodes = (nodes: PNode[]): void => {
      for (const node of nodes) {
        if (node.wantLocal || node.wantField) {
          const index = counter.value++;
          node.local = `$$n${index}`;
          if (node.wantField) node.field = `n${index}`;
        }
        if (node.kind === 'element') nameNodes(node.children);
      }
    };
    nameNodes(block.roots);

    const className = this.options.className;
    const isRoot = block.kind === 'root';
    const ns = this.templateNamespace(block);
    const nsCode = ns === 'svg' ? 1 : ns === 'mathml' ? 2 : 0;
    const single = !isRoot && block.roots.length === 1;
    const html = this.templateHtml(block);

    const members: string[] = [];
    members.push(
      `  static __htmsT${block.id}() {\n    return this.__htmsT${block.id}c || (this.__htmsT${block.id}c = __htmsTpl(${JSON.stringify(html)}, ${nsCode}, ${single}));\n  }\n`
    );

    // create
    const create: string[] = [];
    const params = isRoot
      ? '$$r, $$h'
      : block.kind === 'loop'
        ? '$$P, $$x, $$i'
        : '$$P';
    if (!isRoot) {
      create.push(
        `const $$r = ${className}.__htmsT${block.id}().cloneNode(true);`
      );
    }
    if (single) {
      const root = block.roots[0];
      if (root.local) create.push(`const ${root.local} = $$r;`);
      if (root.kind === 'element') this.walk('$$r', root.children, create);
    } else {
      this.walk('$$r', block.roots, create);
    }

    const literal: string[] = ['c: this'];
    if (!isRoot) {
      literal.push('P: $$P');
      if (block.kind === 'loop')
        literal.push('x: $$x', 'i: $$i', 'k: undefined');
      literal.push(
        single ? 's: $$r' : 's: $$r.firstChild',
        single ? 'e: $$r' : 'e: $$r.lastChild'
      );
    }
    const visitFields = (nodes: PNode[]): void => {
      for (const node of nodes) {
        if (node.field) literal.push(`${node.field}: ${node.local}`);
        if (node.kind === 'element') visitFields(node.children);
      }
    };
    visitFields(block.roots);
    for (const part of block.parts) {
      if (part.kind === 'list') {
        const parent = part.owned
          ? (part.container.element?.local ?? 'null')
          : 'null';
        const anchor = part.owned ? 'null' : part.end.local;
        literal.push(`${part.slot}: { p: ${parent}, a: ${anchor}, b: [] }`);
      } else if (part.kind === 'cond') {
        literal.push(`${part.slot}: { a: ${part.end.local}, k: -1, b: null }`);
      } else if (part.kind === 'text') {
        // The template holds a placeholder, so the first update always writes.
        literal.push(`${part.slot}: __htmsNone`);
      } else {
        const initial =
          part.kind === 'toggle' ? String(part.initial) : 'undefined';
        literal.push(
          `${part.slot}: ${isRoot && initial !== 'undefined' ? `$$h ? __htmsNone : ${initial}` : isRoot ? '$$h ? __htmsNone : undefined' : initial}`
        );
      }
    }
    create.push(`const $$b = { ${literal.join(', ')} };`);

    const tagged = new Set<PElement>();
    for (const action of block.creates) {
      const local = action.node.local as string;
      if (action.kind === 'event') {
        if (action.options === null && DELEGATED_EVENTS.has(action.type)) {
          create.push(
            `${local}.__htms_${action.type} = this.${action.handler};`
          );
          if (!tagged.has(action.node)) {
            tagged.add(action.node);
            create.push(`${local}.__htmsB = $$b;`);
          }
        } else {
          const listener = action.usesEvent
            ? `(event) => this.${action.handler}(event, $$b)`
            : `() => this.${action.handler}($$b)`;
          create.push(
            `${local}.addEventListener(${JSON.stringify(action.type)}, ${listener}${action.options ? `, ${action.options}` : ''});`
          );
        }
      } else if (action.kind === 'code') {
        create.push(action.code(local));
      }
    }
    if (isRoot) {
      for (const part of block.parts) {
        if (part.kind === 'list' && part.owned && part.container.element) {
          // Server-rendered rows are re-created on hydration.
          create.push(
            `if ($$h) ${part.container.element.local}.textContent = '';`
          );
        }
      }
    }
    if (block.dataKeyExpr) {
      const first = block.roots.find(
        (node): node is PElement => node.kind === 'element'
      );
      if (first?.local) {
        create.push(
          `${first.local}.setAttribute('data-key', String(this.${block.keyMethod}($$x, $$i, $$P)));`
        );
      }
    }
    create.push(`this.__htmsU${block.id}($$b, -1);`, 'return $$b;');
    members.push(
      `  __htmsC${block.id}(${params}) {\n${create.map((line) => `    ${line}`).join('\n')}\n  }\n`
    );

    // update
    const update = this.generateUpdate(block);
    const locals = this.declareLocals(block, update.join('\n'), '$$b');
    const header: string[] = [...locals];
    if (
      block.parts.some((part) => part.kind !== 'list' && part.kind !== 'cond')
    ) {
      header.push('let $$v;');
    }
    const flagged = new Set<PElement>();
    for (const part of block.parts) {
      if (part.kind === 'list' || part.kind === 'cond' || part.kind === 'text')
        continue;
      if ((part.node.flag || part.node.styleFlag) && !flagged.has(part.node)) {
        flagged.add(part.node);
        if (part.node.flag)
          header.push(`let ${part.node.flag}${part.node.field} = false;`);
        if (part.node.styleFlag)
          header.push(`let ${part.node.styleFlag}${part.node.field} = false;`);
      }
    }
    members.push(
      `  __htmsU${block.id}($$b, $$d) {\n${[...header, ...update].map((line) => `    ${line}`).join('\n')}\n  }\n`
    );

    // key
    if (block.keyMethod) {
      const expression = this.keyExpressions.get(block) as string;
      const parent = block.parent as BlockPlan;
      const lines: string[] = [];
      for (const variable of block.vars) {
        if (mentions(expression, variable.name)) {
          lines.push(
            `const ${variable.name} = ${variable.field === 'x' ? '$$x' : '$$i'};`
          );
        }
      }
      const own = new Set(block.vars.map((variable) => variable.name));
      for (const variable of this.visibleVars(parent)) {
        if (!own.has(variable.name) && mentions(expression, variable.name)) {
          lines.push(`const ${variable.name} = $$P${variable.path};`);
        }
      }
      lines.push(`return ${expression};`);
      members.push(
        `  ${block.keyMethod}($$x, $$i, $$P) {\n${lines.map((line) => `    ${line}`).join('\n')}\n  }\n`
      );
    }

    return members.join('\n');
  }

  private resolvePlaceholders(code: string): string {
    return code
      .replace(/@@field:(\d+)@@/g, (_, id: string) => {
        const node = this.placeholderNodes[Number(id)];
        if (!node?.field) {
          throw new Error('HTMS block compiler lost an event scope reference');
        }
        return node.field;
      })
      .replace(
        /^[ \t]*this\.__htmsNotifyStateChange\(@@notify:(\d+)@@\);\n/gm,
        (line, id: string) => {
          const pending = this.pendingNotifies.at(Number(id));
          if (!pending) {
            throw new Error('HTMS block compiler lost a handler write mask');
          }
          const mask = this.writeMask(
            pending.block,
            this.resolveStateMasks(pending.code),
            pending.inert
          );
          return mask === 0 ? '' : line.replace(/@@notify:\d+@@/, String(mask));
        }
      );
  }

  // Fills in the masks state helpers report, left as placeholders by the
  // event body renderer because they depend on every binding's reads.
  private resolveStateMasks(code: string): string {
    return code.replace(
      /@@state:([01]):([^@]*)@@/g,
      (_, element: string, path: string) =>
        String(
          this.analyzer.stateWriteMask(
            path.split('.').map(decodeURIComponent),
            element === '1'
          )
        )
    );
  }

  // Emits `const $$nX = <path>` for every node that needs a reference,
  // following firstChild/nextSibling and skipping untouched subtrees.
  private walk(
    parentExpression: string,
    children: PNode[],
    out: string[]
  ): void {
    const needs = (node: PNode): boolean =>
      node.local !== null ||
      (node.kind === 'element' &&
        !(node.ns === 'html' && node.tag === 'template') &&
        node.children.some(needs));
    let last = -1;
    children.forEach((child, index) => {
      if (needs(child)) last = index;
    });
    let previous: string | null = null;
    for (let index = 0; index <= last; index += 1) {
      const child = children.at(index) as PNode;
      const expression: string =
        previous === null
          ? `${parentExpression}.firstChild`
          : `${previous}.nextSibling`;
      if (!needs(child)) {
        previous = expression;
        continue;
      }
      if (!child.local) {
        child.local = `$$w${this.walkCounter++}`;
      }
      out.push(`const ${child.local} = ${expression};`);
      previous = child.local;
      if (child.kind === 'element') {
        this.walk(child.local, child.children, out);
      }
    }
  }

  private walkCounter = 0;

  // The update method's body. Each part runs only when `$$d`, the mask of
  // fields changed since the last update, overlaps the fields it reads;
  // neighbouring parts with the same mask share one test. A create passes
  // -1 (every bit), as does requestUpdate().
  private generateUpdate(block: BlockPlan): string[] {
    const lines: string[] = [];
    let pending: { mask: number; lines: string[] } | null = null;
    const flush = (): void => {
      if (pending) lines.push(...guarded(pending.mask, pending.lines, null));
      pending = null;
    };
    for (const part of block.parts) {
      const update = this.partUpdate(part);
      if (update.flag !== null) {
        flush();
        lines.push(...guarded(update.mask, update.lines, update.flag));
      } else if (pending && pending.mask === update.mask) {
        pending.lines.push(...update.lines);
      } else {
        flush();
        pending = { mask: update.mask, lines: update.lines };
      }
    }
    flush();
    return lines;
  }

  // One part's update statements, the mask guarding them and, for a toggle
  // that must re-apply after a class or style attribute write, that flag.
  private partUpdate(part: Part): {
    mask: number;
    lines: string[];
    flag: string | null;
  } {
    const lines: string[] = [];
    if (part.kind === 'list') {
      const body = part.body;
      // Bits that reach the body only through its item and index: a row
      // that kept both has nothing to update for them unless a write went
      // deep. Index reads keep a moved row updating.
      const skip = part.mask & ~this.blockDirect(body);
      const indexVar = body.vars.find((variable) => variable.field === 'i');
      const readsIndex =
        indexVar !== undefined && this.blockReadsIndex(body, indexVar.name);
      const reconcile = `__htmsList(this, $$b.${part.slot}, ${part.source}, $$b, this.__htmsC${body.id}, this.__htmsU${body.id}, ${body.keyMethod ? `this.${body.keyMethod}` : 'null'}, $$d, ${skip}, ${readsIndex});`;
      const selection = this.listSelection(part);
      if (selection) {
        const list = `$$b.${part.slot}`;
        lines.push(
          `if ($$d & ${part.mask | DEEP_BIT}) {`,
          `  ${list}.q = null;`,
          `  ${list}.v = ${selection};`,
          `  ${reconcile}`,
          '} else {',
          `  __htmsSelect(this, ${list}, ${selection}, this.__htmsU${body.id}, this.${body.keyMethod}, $$d);`,
          '}'
        );
      } else {
        lines.push(reconcile);
      }
      return { mask: part.mask | this.blockMask(part.body), lines, flag: null };
    }
    if (part.kind === 'cond') {
      let mask = part.testMask;
      for (const branch of part.branches) mask |= this.blockMask(branch.body);
      return { mask, lines: this.generateCondition(part), flag: null };
    }
    const slot = `$$b.${part.slot}`;
    if (part.kind === 'text') {
      const raw = rawTextValue(part.expr);
      if (raw === null) {
        lines.push(
          `$$v = ${part.expr};`,
          `if ($$v !== ${slot}) $$b.${part.node.field}.data = ${slot} = $$v;`
        );
      } else {
        // Objects can change their text without changing identity, so
        // they are compared as text against the node every time.
        lines.push(
          `$$v = ${raw};`,
          `if ($$v !== ${slot}) ${slot} = typeof $$v === 'object' && $$v !== null ? __htmsSo($$b.${part.node.field}, $$v) : ($$b.${part.node.field}.data = __htmsS($$v), $$v);`
        );
      }
      return { mask: part.mask, lines, flag: null };
    }
    const node = `$$b.${part.node.field}`;
    const classFlag = part.node.flag
      ? `${part.node.flag}${part.node.field}`
      : null;
    const styleFlag = part.node.styleFlag
      ? `${part.node.styleFlag}${part.node.field}`
      : null;
    // A toggle re-applies when the attribute it shares the node with was
    // rewritten, whether or not its own fields changed.
    let flag: string | null = null;
    switch (part.kind) {
      case 'attr': {
        const name = JSON.stringify(part.name);
        const lower = part.name.toLowerCase();
        const flagSet =
          lower === 'class' && classFlag
            ? ` ${classFlag} = true;`
            : lower === 'style' && styleFlag
              ? ` ${styleFlag} = true;`
              : '';
        if (part.mode === 'bool') {
          lines.push(
            `$$v = !!(${part.expr});`,
            `if ($$v !== ${slot}) { ${slot} = $$v; if ($$v) ${node}.setAttribute(${name}, ''); else ${node}.removeAttribute(${name}); }`
          );
        } else if (part.mode === 'class') {
          lines.push(
            `$$v = ${part.expr};`,
            `if ($$v !== ${slot}) { ${node}.className = ${slot} = $$v;${flagSet} }`
          );
        } else if (part.mode === 'url') {
          lines.push(
            `$$v = ${part.expr};`,
            `if ($$v !== ${slot}) ${node}.setAttribute(${name}, this.__htmsSafeUrl(${slot} = $$v));`
          );
        } else if (part.mode === 'directive') {
          const value = URL_ATTRIBUTES.has(lower)
            ? 'this.__htmsSafeUrl($$v)'
            : 'String($$v)';
          lines.push(
            `$$v = (${part.expr});`,
            `if ($$v !== ${slot}) { ${slot} = $$v; if ($$v == null || $$v === false) ${node}.removeAttribute(${name}); else ${node}.setAttribute(${name}, $$v === true ? '' : ${value});${flagSet} }`
          );
        } else {
          lines.push(
            `$$v = ${part.expr};`,
            `if ($$v !== ${slot}) { ${node}.setAttribute(${name}, ${slot} = $$v);${flagSet} }`
          );
        }
        break;
      }
      case 'toggle':
        flag = classFlag;
        lines.push(
          `$$v = !!(${part.expr});`,
          `if ($$v !== ${slot}${classFlag ? ` || ${classFlag}` : ''}) ${node}.classList.toggle(${JSON.stringify(part.name)}, ${slot} = $$v);`
        );
        break;
      case 'style': {
        flag = styleFlag;
        const property = JSON.stringify(part.property);
        const changed = `$$v !== ${slot}${styleFlag ? ` || ${styleFlag}` : ''}`;
        if (part.mode === 'binding') {
          lines.push(
            `$$v = ${part.expr};`,
            `if (${changed}) { ${slot} = $$v; if ($$v == null || $$v === false) ${node}.style.removeProperty(${property}); else ${node}.style.setProperty(${property}, String($$v)); }`
          );
        } else if (part.mode === 'css') {
          lines.push(
            `$$v = (${part.expr});`,
            `if (${changed}) ${node}.style.setProperty(${property}, ${slot} = $$v);`
          );
        } else {
          lines.push(
            `$$v = (${part.expr});`,
            `if (${changed}) ${node}.style[${property}] = ${slot} = $$v;`
          );
        }
        break;
      }
      case 'show':
        flag = styleFlag;
        lines.push(
          `$$v = !!(${part.expr});`,
          `if ($$v !== ${slot}${styleFlag ? ` || ${styleFlag}` : ''}) ${node}.style.display = (${slot} = $$v) ? '' : 'none';`
        );
        break;
      case 'prop': {
        const access = part.path
          .map((segment) => `[${JSON.stringify(segment)}]`)
          .join('');
        const value = part.url ? `this.__htmsSafeUrl(${part.expr})` : part.expr;
        const evaluate = part.guard
          ? `$$v = (function () { return ${value}; }).call(this);`
          : `$$v = ${value};`;
        const write = part.live
          ? part.path[0] === 'value' && part.path.length === 1
            ? `if (${node}.value !== String($$v)) ${node}.value = $$v;`
            : `if (${node}${access} !== $$v) ${node}${access} = $$v;`
          : `if ($$v !== ${slot}) ${node}${access} = ${slot} = $$v;`;
        if (part.guard) {
          lines.push(
            `try { ${evaluate} ${write} } catch (error) { console.error(${JSON.stringify(part.guard)}, error); }`
          );
        } else {
          lines.push(evaluate, write);
        }
        break;
      }
    }
    return { mask: part.mask, lines, flag };
  }

  // A keyed equality toggle can update just the old/new matching rows when
  // only its component field changed. Other row bindings must depend solely
  // on the source; complex keys, branches and additional fields stay generic.
  private listSelection(list: ListSub): string | null {
    if (!list.keyed || list.mask === ALL_DIRTY || list.mask === 0) return null;
    const key = this.keyExpressions.get(list.body)?.replace(/\s+/g, '');
    const item = list.body.vars.find((variable) => variable.field === 'x');
    if (
      !key ||
      !item ||
      !key.split('.').every((segment) => /^[A-Za-z_$][\w$]*$/.test(segment)) ||
      (key !== item.name && !key.startsWith(`${item.name}.`))
    )
      return null;
    let selection: string | null = null;
    for (const part of list.body.parts) {
      if (part.kind === 'list' || part.kind === 'cond') return null;
      if ((part.mask & ~list.mask) === 0) continue;
      if (selection || part.kind !== 'toggle' || part.node.classWriter)
        return null;
      const operands = part.expr.replace(/\s+/g, '').split('===');
      if (operands.length !== 2) return null;
      const field =
        operands[0] === key
          ? operands[1]
          : operands[1] === key
            ? operands[0]
            : '';
      if (!/^this\.[A-Za-z_$][\w$]*$/.test(field)) return null;
      const bit = this.analyzer.bit(field.slice(5));
      if (bit === ALL_DIRTY || (part.mask & ~list.mask) !== bit) return null;
      selection = field;
    }
    return selection;
  }

  private generateCondition(part: CondSub): string[] {
    const state = `$$b.${part.slot}`;
    const tests: string[] = [];
    let hasDefault = false;
    part.branches.forEach((branch, index) => {
      if (branch.test === null) {
        hasDefault = true;
        tests.push(`${index}`);
      } else {
        tests.push(`(${branch.test}) ? ${index} : `);
      }
    });
    const selector = hasDefault ? tests.join('') : `${tests.join('')}-1`;
    const create = part.branches
      .map(
        (branch, index) =>
          `$$k === ${index} ? this.__htmsC${branch.body.id}($$b) : `
      )
      .join('');
    const update = part.branches
      .map(
        (branch, index) =>
          `${index === 0 ? '' : 'else '}if ($$k === ${index}) this.__htmsU${branch.body.id}($$c.b, $$d);`
      )
      .join(' ');
    // The tests re-run only when a field they read changed; otherwise the
    // branch shown last stays and just updates.
    const retest = part.testMask !== ALL_DIRTY && part.testMask !== 0;
    const choose = retest
      ? [
          `  let $$k = $$c.k;`,
          `  if ($$d & ${part.testMask}) {`,
          ...(part.prelude ? [`    ${part.prelude}`] : []),
          `    $$k = ${selector};`,
          `  }`,
        ]
      : [
          ...(part.prelude ? [`  ${part.prelude}`] : []),
          `  const $$k = ${selector};`,
        ];
    return [
      '{',
      `  const $$c = ${state};`,
      ...choose,
      `  if ($$k !== $$c.k) {`,
      `    if ($$c.b) __htmsRm($$c.b);`,
      `    $$c.k = $$k;`,
      `    $$c.b = ${create}null;`,
      `    if ($$c.b) __htmsIns($$c.b, $$c.a.parentNode, $$c.a);`,
      `  } else ${update}`,
      '}',
    ];
  }
}

// Wraps update statements in their dirty-mask test. Every bit set (-1)
// needs no test. A mask of 0 means the value reads no field at all: it is
// evaluated when the block is created and when everything is marked dirty.
function guarded(
  mask: number,
  lines: readonly string[],
  flag: string | null
): string[] {
  if (mask === ALL_DIRTY) return [...lines];
  const test = mask === 0 ? '$$d === -1' : `$$d & ${mask}`;
  return [
    `if (${flag ? `(${test}) || ${flag}` : test}) {`,
    ...lines.map((line) => `  ${line}`),
    '}',
  ];
}

// Shared helpers for block-rendered components, emitted once per bundle.
// Only function and var declarations, so a classic script can load two
// bundles without redeclaration errors.
export const BLOCK_RUNTIME = `var __htmsNone = {};

function __htmsS(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function __htmsSo(node, value) {
  value = String(value);
  if (node.data !== value) node.data = value;
  return __htmsNone;
}

function __htmsTpl(html, ns, single) {
  var template = document.createElement('template');
  template.innerHTML = ns === 1 ? '<svg>' + html + '</svg>' : ns === 2 ? '<math>' + html + '</math>' : html;
  var fragment = template.content;
  if (ns) {
    var wrapper = fragment.firstChild;
    fragment = document.createDocumentFragment();
    while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
  } else {
    fragment = document.importNode(fragment, true);
  }
  return single ? fragment.firstChild : fragment;
}

function __htmsIns(block, parent, before) {
  var node = block.s;
  var end = block.e;
  // Moving an existing child atomically keeps its rendering/focus state.
  // New rows still need insertion; older browsers use the same fallback.
  if (node === end) {
    if (node.parentNode === parent && parent.moveBefore) parent.moveBefore(node, before);
    else parent.insertBefore(node, before);
    return;
  }
  for (;;) {
    var next = node.nextSibling;
    if (node.parentNode === parent && parent.moveBefore) parent.moveBefore(node, before);
    else parent.insertBefore(node, before);
    if (node === end) return;
    node = next;
  }
}

function __htmsRm(block) {
  var node = block.s;
  var end = block.e;
  if (node === end) {
    node.remove();
    return;
  }
  for (;;) {
    var next = node.nextSibling;
    node.remove();
    if (node === end) return;
    node = next;
  }
}

function __htmsRange(count) {
  var items = new Array(count);
  for (var i = 0; i < count; i++) items[i] = i;
  return items;
}

// Indexes of the longest increasing subsequence of positions (-1 = new).
function __htmsLis(positions) {
  var predecessors = new Int32Array(positions.length);
  var result = [];
  for (var i = 0; i < positions.length; i++) {
    var value = positions[i];
    if (value === -1) continue;
    var size = result.length;
    if (size === 0 || positions[result[size - 1]] < value) {
      predecessors[i] = size > 0 ? result[size - 1] : -1;
      result.push(i);
      continue;
    }
    var low = 0;
    var high = size - 1;
    while (low < high) {
      var middle = (low + high) >> 1;
      if (positions[result[middle]] < value) low = middle + 1;
      else high = middle;
    }
    if (value < positions[result[low]]) {
      predecessors[i] = low > 0 ? result[low - 1] : -1;
      result[low] = i;
    }
  }
  var length = result.length;
  var cursor = length > 0 ? result[length - 1] : -1;
  while (length-- > 0) {
    result[length] = cursor;
    cursor = predecessors[cursor];
  }
  return result;
}

// Creates rows first..last in order before \`before\`. Inserting straight
// into the live parent measures faster in Chrome than filling a detached
// fragment and inserting that.
function __htmsCreate(component, parentBlock, create, items, keys, next, first, last, parent, before) {
  for (var i = first; i <= last; i++) {
    var block = create.call(component, parentBlock, items[i], i);
    if (keys !== null) block.k = keys[i];
    __htmsIns(block, parent, before);
    next[i] = block;
  }
}

// Row updates during reconciliation. \`dirty\` is the mask of changed fields
// and \`kept\` what remains of it for a row that kept its item and position:
// the bits reaching the body only through the item and index are dropped
// unless a write went deep (${DEEP_BIT}). A row that moved and renders its
// index (\`idx\`) keeps the whole mask; one that received a different item
// re-evaluates everything, since the mask describes fields, not rows.
function __htmsKeep(component, block, index, update, dirty, kept, idx) {
  if (block.i !== index) {
    block.i = index;
    if (idx) kept = dirty;
  }
  if (kept !== 0) update.call(component, block, kept);
}

function __htmsTake(component, block, item, index, update) {
  block.x = item;
  block.i = index;
  update.call(component, block, -1);
}

// Build the lookup lazily: lists that never select a row pay no map cost.
// Structural/deep writes invalidate it. Duplicate keys retain the ordinary
// all-row update semantics rather than silently dropping matching rows.
function __htmsSelect(component, list, value, update, key, dirty) {
  var previous = list.v;
  list.v = value;
  if (previous === value) return;
  var index = list.q;
  var blocks = list.b;
  var i;
  if (index == null) {
    index = new Map();
    for (i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var id = key.call(component, block.x, block.i, block.P);
      if (index.has(id)) { index = false; break; }
      index.set(id, block);
    }
    list.q = index;
  }
  if (index === false) {
    for (i = 0; i < blocks.length; i++) update.call(component, blocks[i], dirty);
    return;
  }
  var old = index.get(previous);
  var next = index.get(value);
  if (old) update.call(component, old, dirty);
  if (next && next !== old) update.call(component, next, dirty);
}

function __htmsList(component, list, items, parentBlock, create, update, key, dirty, skip, idx) {
  if (!Array.isArray(items)) items = [];
  var old = list.b;
  var oldLength = old.length;
  var length = items.length;
  var parent = list.p || list.a.parentNode;
  var anchor = list.a;
  var block, i;
  if (length === 0) {
    if (oldLength !== 0) {
      if (list.p) list.p.textContent = '';
      else for (i = 0; i < oldLength; i++) __htmsRm(old[i]);
      list.b = [];
    }
    return;
  }
  var common = length < oldLength ? length : oldLength;
  var item;
  var kept = (dirty & ${DEEP_BIT}) === 0 ? dirty & ~skip : dirty;
  // Rows that kept their item (or, in a keyed list, their key) at the same
  // position update in place, so a render that changed no order allocates
  // nothing. The same object keeps its row without calling the key, and
  // with nothing to update such rows are only compared.
  i = 0;
  if (kept === 0) while (i < common && old[i].x === items[i]) i++;
  for (; i < common; i++) {
    block = old[i];
    item = items[i];
    if (block.x === item) {
      if (kept !== 0) update.call(component, block, kept);
    } else if (key === null || block.k === key.call(component, item, i, parentBlock)) {
      __htmsTake(component, block, item, i, update);
    } else {
      break;
    }
  }
  var same = i;
  var keys;
  if (same === common) {
    // Only the tail differs: drop the extra rows or append the new ones.
    if (length < oldLength) {
      for (i = length; i < oldLength; i++) __htmsRm(old[i]);
      old.length = length;
    } else if (length > oldLength) {
      if (key !== null) {
        keys = new Array(length);
        for (i = oldLength; i < length; i++) keys[i] = key.call(component, items[i], i, parentBlock);
      }
      __htmsCreate(component, parentBlock, create, items, key === null ? null : keys, old, oldLength, length - 1, parent, anchor);
    }
    return;
  }
  var next = new Array(length);
  for (i = 0; i < same; i++) next[i] = old[i];
  var oldStart = same;
  var start = same;
  var oldEnd = oldLength - 1;
  var end = length - 1;
  var before, first, second;
  // Scan matching rows from both ends, then rows whose two ends traded
  // places (a swap). A row matches when it holds the same item or the
  // item's key; keys are only computed when the item changed.
  for (;;) {
    while (oldStart <= oldEnd && start <= end) {
      block = old[oldStart];
      item = items[start];
      if (block.x === item) __htmsKeep(component, block, start, update, dirty, kept, idx);
      else if (block.k === key.call(component, item, start, parentBlock)) __htmsTake(component, block, item, start, update);
      else break;
      oldStart++;
      next[start++] = block;
    }
    while (oldStart <= oldEnd && start <= end) {
      block = old[oldEnd];
      item = items[end];
      if (block.x === item) __htmsKeep(component, block, end, update, dirty, kept, idx);
      else if (block.k === key.call(component, item, end, parentBlock)) __htmsTake(component, block, item, end, update);
      else break;
      oldEnd--;
      next[end--] = block;
    }
    if (oldStart >= oldEnd || start >= end) break;
    first = old[oldStart];
    second = old[oldEnd];
    if (
      !(first.x === items[end] || first.k === key.call(component, items[end], end, parentBlock)) ||
      !(second.x === items[start] || second.k === key.call(component, items[start], start, parentBlock))
    ) {
      break;
    }
    oldStart++;
    oldEnd--;
    before = second.e.nextSibling;
    __htmsIns(second, parent, first.s);
    __htmsIns(first, parent, before);
    if (first.x === items[end]) __htmsKeep(component, first, end, update, dirty, kept, idx);
    else __htmsTake(component, first, items[end], end, update);
    next[end--] = first;
    if (second.x === items[start]) __htmsKeep(component, second, start, update, dirty, kept, idx);
    else __htmsTake(component, second, items[start], start, update);
    next[start++] = second;
  }
  if (start > end) {
    for (i = oldStart; i <= oldEnd; i++) __htmsRm(old[i]);
    list.b = next;
    return;
  }
  keys = new Array(length);
  for (i = start; i <= end; i++) keys[i] = key.call(component, items[i], i, parentBlock);
  if (oldStart > oldEnd) {
    before = end + 1 < length ? next[end + 1].s : anchor;
    __htmsCreate(component, parentBlock, create, items, keys, next, start, end, parent, before);
    list.b = next;
    return;
  }
  var size = end - start + 1;
  var positions = new Int32Array(size).fill(-1);
  var index = new Map();
  for (i = start; i <= end; i++) index.set(keys[i], i);
  var moved = false;
  var last = 0;
  var reused = 0;
  for (i = oldStart; i <= oldEnd; i++) {
    block = old[i];
    var target = index.get(block.k);
    if (target === undefined || positions[target - start] !== -1) continue;
    positions[target - start] = i;
    if (target < last) moved = true;
    else last = target;
    item = items[target];
    if (block.x === item) __htmsKeep(component, block, target, update, dirty, kept, idx);
    else __htmsTake(component, block, item, target, update);
    next[target] = block;
    reused++;
  }
  if (reused === 0 && list.p && start === 0 && oldStart === 0 && oldEnd === oldLength - 1 && end === length - 1) {
    // Every row was replaced: one write clears them all.
    list.p.textContent = '';
    __htmsCreate(component, parentBlock, create, items, keys, next, 0, length - 1, parent, null);
    list.b = next;
    return;
  }
  for (i = oldStart; i <= oldEnd; i++) {
    block = old[i];
    var position = index.get(block.k);
    if (position === undefined || next[position] !== block) __htmsRm(block);
  }
  var sequence = moved ? __htmsLis(positions) : null;
  var cursor = sequence ? sequence.length - 1 : -1;
  for (i = size - 1; i >= 0; i--) {
    var at = start + i;
    before = at + 1 < length ? next[at + 1].s : anchor;
    if (positions[i] === -1) {
      block = create.call(component, parentBlock, items[at], at);
      block.k = keys[at];
      __htmsIns(block, parent, before);
      next[at] = block;
    } else if (moved) {
      if (cursor < 0 || i !== sequence[cursor]) __htmsIns(next[at], parent, before);
      else cursor--;
    }
  }
  list.b = next;
}

// One listener per event type on the render root. Walks from the target to
// the root and runs the handlers this component attached, exposing each
// handler's element as event.currentTarget. A second, capturing listener
// catches events dispatched without bubbles; those only run the target's
// own handler, as a direct listener would.
function __htmsDispatch(component, event) {
  var capturing = event.eventPhase === 1;
  if (capturing && event.bubbles) return;
  var key = '__htms_' + event.type;
  var root = component.__htmsRoot || component;
  var node = event.target;
  var current = null;
  var patched = false;
  try {
    while (node && node !== root) {
      var handler = node[key];
      if (handler !== undefined) {
        var block = node.__htmsB;
        if (block !== undefined && block.c === component) {
          // A handler that never reads the event takes only its block.
          if (handler.length === 1) {
            handler.call(component, block);
          } else {
            if (!patched) {
              patched = true;
              Object.defineProperty(event, 'currentTarget', {
                configurable: true,
                get: function () { return current; }
              });
            }
            current = node;
            handler.call(component, event, block);
          }
          if (event.cancelBubble) break;
        }
      }
      if (capturing) break;
      node = node.parentNode;
    }
  } finally {
    if (patched) delete event.currentTarget;
  }
}

// Removes server-rendered loop and branch content (between <!--[--> and
// <!--]--> markers) so the remaining markup matches the block template.
function __htmsStrip(parent) {
  var node = parent.firstChild;
  while (node) {
    if (node.nodeType === 8 && node.data === '[') {
      var depth = 0;
      var next = node.nextSibling;
      while (next) {
        if (next.nodeType === 8) {
          if (next.data === '[') depth++;
          else if (next.data === ']') {
            if (depth === 0) break;
            depth--;
          }
        }
        var after = next.nextSibling;
        next.remove();
        next = after;
      }
      node = next;
    } else if (node.nodeType === 1 && node.localName !== 'template') {
      __htmsStrip(node);
    }
    node = node && node.nextSibling;
  }
}

// True when existing markup has the template's shape, so the first render
// can adopt it instead of replacing it.
function __htmsSame(actual, expected) {
  var a = actual.firstChild;
  var b = expected.firstChild;
  while (a && b) {
    if (a.nodeType !== b.nodeType) return false;
    if (b.nodeType === 1) {
      if (a.localName !== b.localName || a.namespaceURI !== b.namespaceURI) return false;
      if (b.firstChild && b.localName !== 'template' && !__htmsSame(a, b)) return false;
    }
    a = a.nextSibling;
    b = b.nextSibling;
  }
  return a === b;
}`;
