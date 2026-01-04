export interface TemplateNode {
  type: 'element' | 'text';
  tagName?: string;
  attributes?: Record<string, string>;
  children?: TemplateNode[];
  textContent?: string;
}

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
  count: number;
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

export interface EventDirective {
  kind: 'event';
  selector: string;
  eventType: string;
  body: string[];
  directives?: DirectiveNode[];
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
  mode: 'init' | 'set' | 'push' | 'splice';
  path: string[];
  op?: string;
  value?: string;
  index?: string;
  deleteCount?: string;
  values?: string[];
}

export type DirectiveNode =
  | LoopDirective
  | ConditionDirective
  | EventDirective
  | VisibilityDirective
  | AttributeDirective
  | AppendDirective
  | BindDirective
  | SwitchDirective
  | WhileDirective
  | ClassDirective
  | StyleDirective
  | StateDirective
  | { kind: 'statement'; code: string };

export interface ComponentIR {
  templateNodes: TemplateNode[];
  directives: DirectiveNode[];
}

export function createEmptyComponentIR(): ComponentIR {
  return {
    templateNodes: [],
    directives: []
  };
}
