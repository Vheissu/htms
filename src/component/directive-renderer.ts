import {
  AppendDirective,
  AttributeDirective,
  BindDirective,
  ClassDirective,
  ConditionDirective,
  DirectiveNode,
  EventDirective,
  KeyedListDirective,
  LoopDirective,
  StateDirective,
  StyleDirective,
  SwitchDirective,
  TemplateNode,
  VisibilityDirective,
  WhileDirective,
  walkDirectives,
} from './ir';
import {
  renderEventPreamble,
  serializeTemplateNodes,
  URL_ATTRIBUTES,
} from './template-serializer';

// Statements the reconciling renderer runs for directives: each render
// builds fresh markup into a fragment, resolving selectors against it, and
// the fragment is then reconciled into the live root. Methods and event
// bodies use the same statements in both renderers.

// Per-component state every directive a class renders shares.
export interface RenderContext {
  // Numbers generated variables so their names stay unique in the class.
  counter: { value: number };
  // Component fields bare identifiers in expressions refer to.
  fields: string[];
}

// The mask a state helper reports for a write to `path`, or a placeholder
// the block compiler fills in. `elementWrite` for push and splice.
export type StateMasks = (
  path: readonly string[],
  elementWrite: boolean
) => string | number;

// <event target="window"> and friends listen outside the render root.
export const GLOBAL_EVENT_TARGETS = new Map([
  ['window', 'window'],
  ['document', 'document'],
  [':host', 'this'],
  ['host', 'this'],
]);

export function renderDirective(
  directive: DirectiveNode,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext,
  stateMasks?: StateMasks
): string[] {
  switch (directive.kind) {
    case 'statement':
      return directive.code
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => `${indent}${line}`);
    case 'loop':
      return renderLoop(directive, targetVar, indent, scopeVars, context);
    case 'condition':
      return renderCondition(directive, targetVar, indent, scopeVars, context);
    case 'event':
      return renderEvent(directive, targetVar, indent, scopeVars, context);
    case 'visibility':
      return renderVisibility(directive, targetVar, indent);
    case 'switch':
      return renderSwitch(directive, targetVar, indent, scopeVars, context);
    case 'while':
      return renderWhile(directive, targetVar, indent, scopeVars, context);
    case 'class':
      return renderClass(directive, targetVar, indent);
    case 'style':
      return renderStyle(directive, targetVar, indent);
    case 'attribute':
      return renderAttribute(directive, targetVar, indent);
    case 'append':
      return renderAppend(directive, targetVar, indent, scopeVars, context);
    case 'bind':
      return renderBind(directive, targetVar, indent);
    case 'keyed-list':
      return renderKeyedList(directive, targetVar, indent, scopeVars, context);
    case 'state':
      // init/derive directives are hoisted to the top of render() so state
      // is initialized before any template or directive reads it.
      if (directive.mode === 'init' || directive.mode === 'derive') {
        return [];
      }
      return renderStateDirective(directive, indent, stateMasks);
    default:
      return [];
  }
}

// The statements an <event> directive runs when it fires: its body, then
// its nested directives against `eventRootVar`, then a re-render when any of
// them changed state.
export function renderEventBody(
  directive: EventDirective,
  eventRootVar: string,
  scopeVars: string[],
  context: RenderContext,
  stateMasks?: StateMasks
): string[] {
  const bodyLines =
    directive.body.length > 0 ? [...directive.body] : ['// No statements'];
  for (const nested of directive.directives ?? []) {
    bodyLines.push(
      ...renderDirective(
        nested,
        eventRootVar,
        '',
        scopeVars,
        context,
        stateMasks
      )
    );
  }
  // With dependency masks the block compiler adds the render request from
  // the body's writes; the reconciling renderer re-renders on any change.
  if (stateMasks) return bodyLines;
  let hasStateChange = false;
  walkDirectives(directive.directives, (nested) => {
    if (nested.kind === 'state') {
      hasStateChange = true;
    }
  });
  if (hasStateChange) {
    bodyLines.push(`this.requestUpdate();`);
  }
  return bodyLines;
}

// `stateMasks` gives the mask the state helpers report for the write;
// without it (the reconciling renderer) they report every field.
export function renderStateDirective(
  directive: StateDirective,
  indent: string,
  stateMasks?: StateMasks
): string[] {
  const pathLiteral = JSON.stringify(directive.path);
  const value = directive.value ?? 'undefined';
  const mask =
    stateMasks && directive.path.length > 0
      ? `, ${stateMasks(directive.path, directive.mode === 'push' || directive.mode === 'splice')}`
      : '';

  switch (directive.mode) {
    case 'init':
      return [
        `${indent}this.__htmsInitState(${pathLiteral}, () => (${value}));`,
      ];
    case 'derive':
      return [
        `${indent}{`,
        `${indent}  const resolved = this.__htmsResolvePath(${pathLiteral});`,
        `${indent}  resolved.target[resolved.key] = (${value});`,
        `${indent}}`,
      ];
    case 'set': {
      const op = directive.op ?? '=';
      const operand = op === '++' || op === '--' ? 'undefined' : value;
      return [
        `${indent}this.__htmsSetState(${pathLiteral}, '${op}', () => (${operand})${mask});`,
      ];
    }
    case 'push':
      return [
        `${indent}this.__htmsPushState(${pathLiteral}, () => (${value})${mask});`,
      ];
    case 'splice':
      return [
        `${indent}this.__htmsSpliceState(${pathLiteral}, () => (${directive.index ?? '0'}), () => (${directive.deleteCount ?? '0'}), () => [${(directive.values ?? []).join(', ')}]${mask});`,
      ];
    default:
      return [];
  }
}

// Runs `body` for every element under `targetVar` matching `selector`,
// each bound to `node`.
function forEachTarget(
  targetVar: string,
  selector: string,
  indent: string,
  body: (bodyIndent: string) => string[],
  listVar = 'targets'
): string[] {
  const innerIndent = `${indent}  `;
  return [
    `${indent}{`,
    `${innerIndent}const ${listVar} = ${targetVar}.querySelectorAll(${JSON.stringify(selector)});`,
    `${innerIndent}${listVar}.forEach(node => {`,
    ...body(`${innerIndent}  `),
    `${innerIndent}});`,
    `${indent}}`,
  ];
}

// Builds markup and directives into a fragment.
function fillFragment(
  fragmentVar: string,
  template: TemplateNode[],
  directives: DirectiveNode[] | undefined,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const lines: string[] = [];
  const serialized = serializeTemplateNodes(
    template,
    fragmentVar,
    scopeVars,
    context.fields,
    (nested, target) => renderDirective(nested, target, '', scopeVars, context),
    context.counter
  );
  for (const line of serialized.split('\n')) {
    if (line.trim().length > 0) lines.push(`${indent}${line}`);
  }
  for (const nested of directives ?? []) {
    lines.push(
      ...renderDirective(nested, fragmentVar, indent, scopeVars, context)
    );
  }
  return lines;
}

// Builds markup and directives into a new fragment appended to `targetVar`.
function appendFragment(
  targetVar: string,
  template: TemplateNode[],
  directives: DirectiveNode[] | undefined,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const fragmentVar = `_frag${context.counter.value++}`;
  return [
    `${indent}const ${fragmentVar} = document.createDocumentFragment();`,
    ...fillFragment(
      fragmentVar,
      template,
      directives,
      indent,
      scopeVars,
      context
    ),
    `${indent}${targetVar}.appendChild(${fragmentVar});`,
  ];
}

function renderLoop(
  directive: LoopDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const { counter } = context;
  const lines: string[] = [];
  const fragmentVar = `_frag${counter.value++}`;
  const innerIndent = `${indent}  `;
  const loopScopeVars = [...scopeVars];

  if (directive.mode === 'array') {
    const rawSourceVar = `_source${counter.value++}`;
    const arraySourceVar = `_items${counter.value++}`;
    lines.push(
      `${indent}const ${rawSourceVar} = ${directive.source};`,
      `${indent}const ${arraySourceVar} = Array.isArray(${rawSourceVar}) ? ${rawSourceVar} : [];`
    );
    loopScopeVars.push(directive.itemVar);
    if (directive.indexVar) {
      loopScopeVars.push(directive.indexVar);
      lines.push(
        `${indent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${arraySourceVar}.length; ${directive.indexVar}++) {`,
        `${innerIndent}const ${directive.itemVar} = ${arraySourceVar}[${directive.indexVar}];`
      );
    } else {
      lines.push(
        `${indent}for (const ${directive.itemVar} of ${arraySourceVar}) {`
      );
    }
  } else {
    loopScopeVars.push(directive.indexVar);
    const countVar = `_count${counter.value++}`;
    lines.push(
      `${indent}const ${countVar} = ${directive.count};`,
      `${indent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${countVar}; ${directive.indexVar}++) {`
    );
  }

  lines.push(
    `${innerIndent}const ${fragmentVar} = document.createDocumentFragment();`,
    ...fillFragment(
      fragmentVar,
      directive.template,
      directive.directives,
      innerIndent,
      loopScopeVars,
      context
    )
  );
  if (directive.mode === 'array' && directive.key) {
    // Reconciliation matches keyed rows by data-key, so reordering moves
    // their DOM nodes instead of rewriting them.
    const keyedVar = `_keyed${counter.value++}`;
    lines.push(
      `${innerIndent}const ${keyedVar} = ${fragmentVar}.firstElementChild;`,
      `${innerIndent}if (${keyedVar}) { ${keyedVar}.setAttribute('data-key', String(${directive.key})); }`
    );
  }
  lines.push(
    `${innerIndent}${targetVar}.appendChild(${fragmentVar});`,
    `${indent}}`
  );
  return lines;
}

function renderCondition(
  directive: ConditionDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const branchIndent = `${indent}  `;
  const lines = [
    `${indent}if (${directive.condition}) {`,
    ...appendFragment(
      targetVar,
      directive.whenTrue.template,
      directive.whenTrue.directives,
      branchIndent,
      scopeVars,
      context
    ),
    `${indent}}`,
  ];
  if (directive.whenFalse) {
    lines.push(
      `${indent}else {`,
      ...appendFragment(
        targetVar,
        directive.whenFalse.template,
        directive.whenFalse.directives,
        branchIndent,
        scopeVars,
        context
      ),
      `${indent}}`
    );
  }
  return lines;
}

function renderSwitch(
  directive: SwitchDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const switchVar = `_switch${context.counter.value++}`;
  const branchIndent = `${indent}  `;
  const lines = [`${indent}const ${switchVar} = ${directive.expression};`];

  directive.cases.forEach((caseBlock, index) => {
    lines.push(
      `${indent}${index === 0 ? 'if' : 'else if'} (${switchVar} === ${caseBlock.value}) {`,
      ...appendFragment(
        targetVar,
        caseBlock.template,
        caseBlock.directives,
        branchIndent,
        scopeVars,
        context
      ),
      `${indent}}`
    );
  });
  if (directive.defaultCase) {
    lines.push(
      `${indent}else {`,
      ...appendFragment(
        targetVar,
        directive.defaultCase.template,
        directive.defaultCase.directives,
        branchIndent,
        scopeVars,
        context
      ),
      `${indent}}`
    );
  }
  return lines;
}

function renderWhile(
  directive: WhileDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const guardVar = `_guard${context.counter.value++}`;
  const innerIndent = `${indent}  `;
  const loopIndent = `${innerIndent}  `;
  return [
    `${indent}{`,
    `${innerIndent}let ${guardVar} = 0;`,
    `${innerIndent}while (${directive.condition}) {`,
    `${loopIndent}if (${guardVar}++ >= ${directive.maxIterations}) { console.warn('WHILE exceeded max iterations'); break; }`,
    ...appendFragment(
      targetVar,
      directive.template,
      directive.directives,
      loopIndent,
      scopeVars,
      context
    ),
    `${innerIndent}}`,
    `${indent}}`,
  ];
}

function renderEvent(
  directive: EventDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const { counter } = context;
  const handlerVar = `_handler${counter.value++}`;
  const eventRootVar = `_eventRoot${counter.value++}`;
  const timerVar = `_timer${counter.value++}`;
  const innerIndent = `${indent}  `;
  const bodyIndent = `${innerIndent}    `;
  const modifiers = directive.modifiers ?? {};

  // The statements that run when the event fires (or after debounce).
  const bodyLines: string[] = [
    `const ${eventRootVar} = this.__htmsResolveEventRoot(event.currentTarget, ${targetVar});`,
    ...renderEventBody(directive, eventRootVar, scopeVars, context),
  ];

  const listenerOptions =
    modifiers.once || modifiers.passive
      ? `, { once: ${modifiers.once === true}, passive: ${modifiers.passive === true} }`
      : '';

  // Listeners are re-created on every render, so per-listener state (the
  // `once` flag, pending debounce timers) lives on the mounted element and
  // the component, keyed by this directive's id.
  const listenerId = JSON.stringify(timerVar);
  const globalTarget = GLOBAL_EVENT_TARGETS.get(directive.selector.trim());
  const eventType = JSON.stringify(directive.eventType);
  const lines = [
    `${indent}{`,
    globalTarget
      ? `${innerIndent}const eventTargets = typeof window === 'undefined' ? [] : [${globalTarget}];`
      : `${innerIndent}const eventTargets = ${targetVar}.querySelectorAll(${JSON.stringify(directive.selector)});`,
    `${innerIndent}eventTargets.forEach(targetEl => {`,
    `${bodyIndent}const ${handlerVar} = (event) => {`,
    ...renderEventPreamble(modifiers, listenerId, `${bodyIndent}  `),
  ];
  if (modifiers.debounceMs !== undefined) {
    lines.push(
      `${bodyIndent}  this.__htmsDebounce(event, ${listenerId}, ${modifiers.debounceMs}, (event) => {`,
      ...bodyLines.map((line) => `${bodyIndent}    ${line}`),
      `${bodyIndent}  });`
    );
  } else {
    lines.push(...bodyLines.map((line) => `${bodyIndent}  ${line}`));
  }
  // Window, document and host listeners attach directly for this render;
  // element listeners are marked on the fresh node and attached to the
  // live node during reconciliation.
  lines.push(
    `${bodyIndent}};`,
    globalTarget
      ? `${bodyIndent}this.__htmsListen(targetEl, ${eventType}, ${handlerVar}${listenerOptions});`
      : `${bodyIndent}this.__htmsMarkListener(targetEl, ${eventType}, ${handlerVar}${listenerOptions});`,
    `${innerIndent}});`,
    `${indent}}`
  );
  return lines;
}

function renderVisibility(
  directive: VisibilityDirective,
  targetVar: string,
  indent: string
): string[] {
  return forEachTarget(targetVar, directive.selector, indent, (bodyIndent) => [
    `${bodyIndent}node.style.display = (${directive.condition}) ? '' : 'none';`,
  ]);
}

function renderAttribute(
  directive: AttributeDirective,
  targetVar: string,
  indent: string
): string[] {
  const name = JSON.stringify(directive.name);
  const value = directive.value;
  return forEachTarget(targetVar, directive.selector, indent, (bodyIndent) => {
    if (directive.target === 'attribute') {
      const safeValue = URL_ATTRIBUTES.has(directive.name.toLowerCase())
        ? `this.__htmsSafeUrl(attributeValue)`
        : 'String(attributeValue)';
      return [
        `${bodyIndent}const attributeValue = ${value};`,
        `${bodyIndent}if (attributeValue == null || attributeValue === false) { node.removeAttribute(${name}); }`,
        `${bodyIndent}else { node.setAttribute(${name}, attributeValue === true ? '' : ${safeValue}); }`,
      ];
    }
    const path = directive.path ?? [directive.name];
    const access =
      directive.path && directive.path.length > 1
        ? directive.path.map((segment) => `['${segment}']`).join('')
        : `[${name}]`;
    return [
      URL_ATTRIBUTES.has(path[0].toLowerCase())
        ? `${bodyIndent}const propertyValue = this.__htmsSafeUrl(${value});`
        : `${bodyIndent}const propertyValue = ${value};`,
      `${bodyIndent}node${access} = propertyValue;`,
      `${bodyIndent}this.__htmsMarkProperty(node, ${JSON.stringify(path)}, propertyValue);`,
    ];
  });
}

function renderClass(
  directive: ClassDirective,
  targetVar: string,
  indent: string
): string[] {
  const classList = directive.classNames
    .map((name) => JSON.stringify(name))
    .join(', ');
  const update = directive.condition
    ? `node.classList.toggle(cls, !!(${directive.condition}));`
    : directive.action === 'add'
      ? 'node.classList.add(cls);'
      : directive.action === 'remove'
        ? 'node.classList.remove(cls);'
        : 'node.classList.toggle(cls);';
  return forEachTarget(targetVar, directive.selector, indent, (bodyIndent) => [
    `${bodyIndent}const classes = [${classList}];`,
    `${bodyIndent}classes.forEach(cls => {`,
    `${bodyIndent}  ${update}`,
    `${bodyIndent}});`,
  ]);
}

function renderStyle(
  directive: StyleDirective,
  targetVar: string,
  indent: string
): string[] {
  const prop = JSON.stringify(directive.property);
  return forEachTarget(targetVar, directive.selector, indent, (bodyIndent) => [
    directive.mode === 'css'
      ? `${bodyIndent}node.style.setProperty(${prop}, ${directive.value});`
      : `${bodyIndent}node.style[${prop}] = ${directive.value};`,
  ]);
}

function renderAppend(
  directive: AppendDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  return forEachTarget(targetVar, directive.selector, indent, (bodyIndent) =>
    appendFragment(
      'node',
      directive.template,
      directive.directives,
      bodyIndent,
      scopeVars,
      context
    )
  );
}

function renderBind(
  directive: BindDirective,
  targetVar: string,
  indent: string
): string[] {
  const property = JSON.stringify(directive.property);
  const failure = JSON.stringify(
    `BIND evaluation failed for ${directive.selector}`
  );
  return forEachTarget(
    targetVar,
    directive.selector,
    indent,
    (bodyIndent) => [
      `${bodyIndent}try {`,
      `${bodyIndent}  const value = (function() { return ${directive.expression}; }).call(this);`,
      `${bodyIndent}  node[${property}] = value;`,
      `${bodyIndent}  this.__htmsMarkProperty(node, [${property}], value);`,
      `${bodyIndent}} catch (error) {`,
      `${bodyIndent}  console.error(${failure}, error);`,
      `${bodyIndent}}`,
    ],
    'nodes'
  );
}

function renderKeyedList(
  directive: KeyedListDirective,
  targetVar: string,
  indent: string,
  scopeVars: string[],
  context: RenderContext
): string[] {
  const { counter } = context;
  const innerIndent = `${indent}  `;
  const bodyIndent = `${innerIndent}  `;
  const loopIndent = `${bodyIndent}  `;
  const targetsVar = `_targets${counter.value++}`;
  const rawSourceVar = `_source${counter.value++}`;
  const arraySourceVar = `_items${counter.value++}`;
  const fragmentVar = `_frag${counter.value++}`;
  const keyVar = `_key${counter.value++}`;
  const keyTextVar = `_keyText${counter.value++}`;
  const keyedNodeVar = `_keyedNode${counter.value++}`;
  const { itemVar, indexVar } = directive;
  const loopScopeVars = [...scopeVars, itemVar, indexVar];

  const lines = [
    `${indent}{`,
    `${innerIndent}const ${targetsVar} = ${targetVar}.querySelectorAll(${JSON.stringify(directive.selector)});`,
    `${innerIndent}${targetsVar}.forEach(container => {`,
    `${bodyIndent}const ${rawSourceVar} = ${directive.source};`,
    `${bodyIndent}const ${arraySourceVar} = Array.isArray(${rawSourceVar}) ? ${rawSourceVar} : [];`,
    `${bodyIndent}for (let ${indexVar} = 0; ${indexVar} < ${arraySourceVar}.length; ${indexVar}++) {`,
    `${loopIndent}const ${itemVar} = ${arraySourceVar}[${indexVar}];`,
    `${loopIndent}const ${fragmentVar} = document.createDocumentFragment();`,
    ...fillFragment(
      fragmentVar,
      directive.template,
      undefined,
      loopIndent,
      loopScopeVars,
      context
    ),
    `${loopIndent}const ${keyVar} = ${directive.key};`,
    `${loopIndent}const ${keyTextVar} = String(${keyVar});`,
    `${loopIndent}const ${keyedNodeVar} = ${fragmentVar}.firstElementChild;`,
    `${loopIndent}if (${keyedNodeVar} && typeof ${keyedNodeVar}.setAttribute === 'function') {`,
    `${loopIndent}  ${keyedNodeVar}.setAttribute('data-key', ${keyTextVar});`,
    `${loopIndent}}`,
    `${loopIndent}if (${keyedNodeVar}) {`,
    `${loopIndent}  container.appendChild(${keyedNodeVar});`,
  ];
  for (const nested of directive.directives ?? []) {
    lines.push(
      ...renderDirective(
        nested,
        keyedNodeVar,
        `${loopIndent}  `,
        loopScopeVars,
        context
      )
    );
  }
  lines.push(
    `${loopIndent}} else {`,
    `${loopIndent}  container.appendChild(${fragmentVar});`,
    `${loopIndent}}`,
    `${bodyIndent}}`,
    `${innerIndent}});`,
    `${indent}}`
  );
  return lines;
}
