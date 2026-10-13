export interface TemplateNode {
  type: 'element' | 'text';
  tagName?: string;
  namespace?: 'html' | 'svg' | 'mathml';
  attributes?: Record<string, string>;
  // Inline directive attributes (on:click, bind:value, class:x, style:x, if).
  bindings?: TemplateBinding[];
  children?: TemplateChild[];
  textContent?: string;
}

export interface EventBinding {
  kind: 'event';
  eventType: string;
  code: string;
  modifiers: EventModifiers;
}

export interface ModelBinding {
  kind: 'model';
  property: string;
  eventType: string;
  path: string;
  numeric: boolean;
}

export interface ClassBinding {
  kind: 'class';
  className: string;
  expression: string;
}

export interface StyleBinding {
  kind: 'style';
  property: string;
  expression: string;
}

export interface ConditionalBinding {
  kind: 'if';
  expression: string;
}

export type TemplateBinding =
  | EventBinding
  | ModelBinding
  | ClassBinding
  | StyleBinding
  | ConditionalBinding;

// A directive embedded as a child of a template element. Rendered in
// document order with the parent element as the directive target, so
// `<div><event .../></div>` scopes the event to that div's subtree.
export interface DirectiveTemplateChild {
  type: 'directive';
  directive: DirectiveNode;
}

export type TemplateChild = TemplateNode | DirectiveTemplateChild;

export interface ArrayLoopDirective {
  kind: 'loop';
  mode: 'array';
  source: string;
  itemVar: string;
  indexVar?: string;
  template: TemplateNode[];
  directives?: DirectiveNode[];
}

export interface RangeLoopDirective {
  kind: 'loop';
  mode: 'range';
  // A numeric literal or an expression evaluated on each render.
  count: string;
  indexVar: string;
  template: TemplateNode[];
  directives?: DirectiveNode[];
}

export type LoopDirective = ArrayLoopDirective | RangeLoopDirective;

export interface ConditionDirective {
  kind: 'condition';
  condition: string;
  whenTrue: {
    template: TemplateNode[];
    directives?: DirectiveNode[];
  };
  whenFalse?: {
    template: TemplateNode[];
    directives?: DirectiveNode[];
  };
}

export interface EventModifiers {
  prevent?: boolean;
  stop?: boolean;
  once?: boolean;
  passive?: boolean;
  debounceMs?: number;
  key?: string;
  self?: boolean;
  capture?: boolean;
}

export interface EventDirective {
  kind: 'event';
  selector: string;
  eventType: string;
  body: string[];
  directives?: DirectiveNode[];
  modifiers?: EventModifiers;
}

export interface VisibilityDirective {
  kind: 'visibility';
  selector: string;
  condition: string;
  mode: 'toggle' | 'show';
}

export interface AttributeDirective {
  kind: 'attribute';
  selector: string;
  target: 'attribute' | 'property';
  name: string;
  path?: string[];
  value: string;
}

export interface AppendDirective {
  kind: 'append';
  selector: string;
  template: TemplateNode[];
  directives?: DirectiveNode[];
}

export interface BindDirective {
  kind: 'bind';
  selector: string;
  property: string;
  expression: string;
}

export interface KeyedListDirective {
  kind: 'keyed-list';
  runtimeId?: string;
  selector: string;
  source: string;
  itemVar: string;
  indexVar: string;
  key: string;
  template: TemplateNode[];
  directives?: DirectiveNode[];
}

export interface SwitchCase {
  value: string;
  template: TemplateNode[];
  directives?: DirectiveNode[];
}

export interface SwitchDirective {
  kind: 'switch';
  expression: string;
  cases: SwitchCase[];
  defaultCase?: {
    template: TemplateNode[];
    directives?: DirectiveNode[];
  };
}

export interface WhileDirective {
  kind: 'while';
  condition: string;
  maxIterations: number;
  template: TemplateNode[];
  directives?: DirectiveNode[];
}

export interface ClassDirective {
  kind: 'class';
  selector: string;
  classNames: string[];
  action: 'add' | 'remove' | 'toggle';
  condition?: string;
}

export interface StyleDirective {
  kind: 'style';
  selector: string;
  property: string;
  value: string;
  mode: 'property' | 'css';
}

export interface StateDirective {
  kind: 'state';
  mode: 'init' | 'derive' | 'set' | 'push' | 'splice';
  path: string[];
  op?: string;
  value?: string;
  index?: string;
  deleteCount?: string;
  values?: string[];
}

// A <function> inside a component: compiled to a class method.
export interface MethodDirective {
  kind: 'method';
  name: string;
  params: string[];
  async: boolean;
  body: DirectiveNode[];
}

export interface StatementDirective {
  kind: 'statement';
  code: string;
  requiresRuntime?: boolean;
  emittedEventName?: string;
}

export type DirectiveNode =
  | LoopDirective
  | ConditionDirective
  | EventDirective
  | VisibilityDirective
  | AttributeDirective
  | AppendDirective
  | BindDirective
  | KeyedListDirective
  | SwitchDirective
  | WhileDirective
  | ClassDirective
  | StyleDirective
  | StateDirective
  | MethodDirective
  | StatementDirective;

export interface ComponentIR {
  templateNodes: TemplateNode[];
  directives: DirectiveNode[];
}

export function createEmptyComponentIR(): ComponentIR {
  return {
    templateNodes: [],
    directives: [],
  };
}

export type DirectiveVisitor = (directive: DirectiveNode) => void;

// Visit every directive in a tree, including directives nested inside
// branches, loop bodies, and template children.
export function walkDirectives(
  directives: readonly DirectiveNode[] | undefined,
  visit: DirectiveVisitor
): void {
  if (!directives) return;
  for (const directive of directives) {
    visit(directive);
    walkDirectiveContent(directive, visit);
  }
}

function walkDirectiveContent(
  directive: DirectiveNode,
  visit: DirectiveVisitor
): void {
  switch (directive.kind) {
    case 'loop':
    case 'while':
      walkTemplateNodes(directive.template, visit);
      walkDirectives(directive.directives, visit);
      break;
    case 'condition':
      walkTemplateNodes(directive.whenTrue.template, visit);
      walkDirectives(directive.whenTrue.directives, visit);
      if (directive.whenFalse) {
        walkTemplateNodes(directive.whenFalse.template, visit);
        walkDirectives(directive.whenFalse.directives, visit);
      }
      break;
    case 'event':
      walkDirectives(directive.directives, visit);
      break;
    case 'method':
      walkDirectives(directive.body, visit);
      break;
    case 'keyed-list':
    case 'append':
      walkTemplateNodes(directive.template, visit);
      walkDirectives(directive.directives, visit);
      break;
    case 'switch':
      for (const switchCase of directive.cases) {
        walkTemplateNodes(switchCase.template, visit);
        walkDirectives(switchCase.directives, visit);
      }
      if (directive.defaultCase) {
        walkTemplateNodes(directive.defaultCase.template, visit);
        walkDirectives(directive.defaultCase.directives, visit);
      }
      break;
    case 'state':
    case 'visibility':
    case 'attribute':
    case 'bind':
    case 'class':
    case 'style':
    case 'statement':
      break;
  }
}

// Visit every directive embedded as a child of the given template nodes.
export function walkTemplateNodes(
  nodes: readonly TemplateNode[] | undefined,
  visit: DirectiveVisitor
): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (node.type !== 'element' || !node.children) continue;
    for (const child of node.children) {
      if (child.type === 'directive') {
        visit(child.directive);
        walkDirectiveContent(child.directive, visit);
      } else {
        walkTemplateNodes([child], visit);
      }
    }
  }
}

// Visit every directive reachable from a component IR — top-level
// directives and directives embedded inside template markup.
export function walkComponentIR(
  ir: ComponentIR,
  visit: DirectiveVisitor
): void {
  walkTemplateNodes(ir.templateNodes, visit);
  walkDirectives(ir.directives, visit);
}

function directiveTemplates(directive: DirectiveNode): TemplateNode[][] {
  switch (directive.kind) {
    case 'loop':
    case 'while':
    case 'keyed-list':
    case 'append':
      return [directive.template];
    case 'condition':
      return directive.whenFalse
        ? [directive.whenTrue.template, directive.whenFalse.template]
        : [directive.whenTrue.template];
    case 'switch':
      return [
        ...directive.cases.map((switchCase) => switchCase.template),
        ...(directive.defaultCase ? [directive.defaultCase.template] : []),
      ];
    default:
      return [];
  }
}

// Visit every template element reachable from a component IR, including
// markup inside loops, branches and other directives.
export function walkTemplateElements(
  ir: ComponentIR,
  visit: (node: TemplateNode) => void
): void {
  const visitNodes = (nodes: readonly TemplateNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.type !== 'element') continue;
      visit(node);
      // Embedded directives are reached through walkComponentIR below.
      visitNodes(
        (node.children ?? []).filter(
          (child): child is TemplateNode => child.type !== 'directive'
        )
      );
    }
  };
  const visitDirective = (directive: DirectiveNode): void => {
    for (const templates of directiveTemplates(directive)) {
      visitNodes(templates);
    }
  };
  visitNodes(ir.templateNodes);
  walkComponentIR(ir, visitDirective);
}
