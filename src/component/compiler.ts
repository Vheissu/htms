import { parseComponentSource } from './source-parser';
import { NATIVE_ELEMENT_PROPERTIES } from './native-properties';
import { elementsToComponentCode } from './renderer';
import {
  BLOCK_RUNTIME,
  BlockComponentPlan,
  UnsupportedBlockFeature,
  compileBlockComponent,
} from './block-compiler';
import {
  ALL_DIRTY,
  DEEP_BIT,
  DependencyAnalyzer,
  MethodCode,
  collectAliases,
  isPureExpression,
} from './dependencies';
import {
  ComponentIR,
  StateDirective,
  MethodDirective,
  walkComponentIR,
  walkTemplateElements,
} from './ir';
import {
  RenderContext,
  StateMasks,
  renderDirective,
  renderEventBody,
  renderStateDirective,
} from './directive-renderer';
import {
  serializeTemplateNodes,
  templateNodesHaveDirectives,
  templateNodesHaveInterpolations,
  templateNodesToHTML,
} from './template-serializer';
import {
  CompilerError,
  CompilerWarning,
  ParseOptions,
  ComponentCompileResult,
  ComponentArtifact,
  ComponentInputType,
} from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { ensureRuntime } from '../utils/runtime';
import { addNodeLocation, addNodeLocations } from '../diagnostics';
import { SourceDocument, SourceElement } from '../source-dom';
import { withReadOnlyParseCache } from '../utils/js-parser';
import {
  ATTRIBUTE_CHANGED_CALLBACK,
  CONSTRUCTOR_START,
  DISCONNECT_START,
  DISPOSE_EFFECTS,
  ENSURE_RENDER_ROOT,
  FOCUS_HELPERS,
  LEGACY_LISTENER_HELPERS,
  SHARED_EVENT_HELPERS,
  STATE_HELPERS,
  UPDATE_HELPERS,
  inputHelpers,
  reconciliationHelpers,
  renderMethod,
  renderRootHelper,
  staticTemplateGetter,
} from './class-helpers';

interface ComponentMetadata {
  tagName: string;
  className: string;
  shadowMode: 'open' | 'closed' | 'none';
  props: ComponentProperty[];
  observedAttributes: string[];
  inputs: ComponentInput[];
}

interface ComponentProperty {
  propName: string;
  type: ComponentInputType;
}

interface ComponentInput {
  propName: string;
  attributeName: string;
  type: ComponentInputType;
}

const SHADOW_MODES = new Set(['open', 'closed', 'none']);
const COMPONENT_INPUT_TYPES = new Set<ComponentInputType>([
  'string',
  'number',
  'boolean',
  'json',
]);
const VALID_CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/;
// Public helpers every generated component exposes.
const BUILTIN_COMPONENT_FIELDS = ['$', '$$', 'emit', 'requestUpdate'];

const RESERVED_COMPONENT_PROPERTIES = new Set([
  ...BUILTIN_COMPONENT_FIELDS,
  '__proto__',
  'attributeChangedCallback',
  'connectedCallback',
  'constructor',
  'disconnectedCallback',
  'prototype',
  'render',
  'renderError',
  'requestUpdate',
  'shadowRoot',
  'updateComplete',
]);

// Names a component field cannot take: the generated class's own members
// and HTMLElement properties.
function conflictsWithElement(name: string): boolean {
  return (
    name.startsWith('__htms') ||
    RESERVED_COMPONENT_PROPERTIES.has(name) ||
    NATIVE_ELEMENT_PROPERTIES.has(name)
  );
}

interface LifecycleState {
  init: StateDirective[];
  derive: StateDirective[];
}

// What class generation needs to know about a component's IR, gathered in
// one walk. Lists keep the order their directives appear in.
interface ComponentSummary {
  methods: MethodDirective[];
  // Roots of every state path, and of the paths state is initialized at.
  stateRoots: string[];
  initialStateRoots: string[];
  // State init/derive directives can appear anywhere in the IR (top level,
  // inside branches, or embedded in markup). They are hoisted to the top of
  // render() so declared state is initialized before any template uses it.
  lifecycleState: LifecycleState;
  emittedEvents: string[];
  // Selectors of elements whose properties the component sets.
  controlledSelectors: string[];
  hasState: boolean;
  // <event> directives, or event or model bindings.
  hasEvents: boolean;
  hasBindings: boolean;
  requiresRuntime: boolean;
}

function summarizeComponent(ir: ComponentIR): ComponentSummary {
  const methods: MethodDirective[] = [];
  const stateRoots = new Set<string>();
  const initialStateRoots = new Set<string>();
  const lifecycleState: LifecycleState = { init: [], derive: [] };
  const emittedEvents = new Set<string>();
  const controlledSelectors = new Set<string>();
  let hasState = false;
  let hasEvents = false;
  let requiresRuntime = false;
  walkComponentIR(ir, (directive) => {
    switch (directive.kind) {
      case 'method':
        methods.push(directive);
        break;
      case 'state': {
        hasState = true;
        const [root] = directive.path;
        if (root !== undefined) stateRoots.add(root);
        if (directive.mode === 'init') {
          if (root !== undefined) initialStateRoots.add(root);
          lifecycleState.init.push(directive);
        } else if (directive.mode === 'derive') {
          lifecycleState.derive.push(directive);
        }
        break;
      }
      case 'statement':
        if (directive.emittedEventName) {
          emittedEvents.add(directive.emittedEventName);
        }
        if (directive.requiresRuntime) requiresRuntime = true;
        break;
      case 'event':
        hasEvents = true;
        break;
      case 'bind':
        controlledSelectors.add(directive.selector);
        break;
      case 'attribute':
        if (directive.target === 'property') {
          controlledSelectors.add(directive.selector);
        }
        break;
    }
  });
  let hasBindings = false;
  walkTemplateElements(ir, (node) => {
    if (!node.bindings || node.bindings.length === 0) return;
    hasBindings = true;
    if (
      node.bindings.some(
        (binding) => binding.kind === 'event' || binding.kind === 'model'
      )
    ) {
      hasEvents = true;
    }
  });
  return {
    methods,
    stateRoots: [...stateRoots],
    initialStateRoots: [...initialStateRoots],
    lifecycleState,
    emittedEvents: [...emittedEvents],
    controlledSelectors: [...controlledSelectors],
    hasState,
    hasEvents,
    hasBindings,
    requiresRuntime,
  };
}

export function compileComponents(
  htmlContent: string,
  options: ParseOptions = {}
): ComponentCompileResult {
  return withReadOnlyParseCache(() =>
    compileComponentSource(htmlContent, options)
  );
}

function compileComponentSource(
  htmlContent: string,
  options: ParseOptions
): ComponentCompileResult {
  const document = parseComponentSource(htmlContent);
  const bodyChildren = document.body ? [...document.body.children] : [];
  const componentSnippets: string[] = [];
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];
  const artifacts: ComponentArtifact[] = [];
  const componentNames = new Set<string>();
  const componentClassNames = new Set<string>();
  let requiresRuntime = false;
  let usesBlocks = false;

  if (bodyChildren.length === 0) {
    errors.push({
      type: 'validation',
      message:
        'No root elements found. Expected at least one <component> element.',
    });
    return { success: false, errors, warnings, components: [] };
  }

  for (const child of bodyChildren) {
    if (child.tagName.toLowerCase() !== 'component') {
      const error: CompilerError = {
        type: 'validation',
        message: `Root element <${child.tagName.toLowerCase()}> is not allowed. Wrap markup in a <component> root.`,
        tag: child.tagName,
        hint: 'Every HTMS file starts with a <component name="my-element"> root.',
      };
      errors.push(addNodeLocation(error, child));
      continue;
    }

    const compileResult = compileComponentElement(child, options);
    requiresRuntime ||= compileResult.requiresRuntime;
    usesBlocks ||= compileResult.usesBlocks === true;
    errors.push(...compileResult.errors);
    warnings.push(...compileResult.warnings);
    if (compileResult.artifact) {
      if (componentNames.has(compileResult.artifact.tagName)) {
        const error: CompilerError = {
          type: 'validation',
          message: `Duplicate component name "${compileResult.artifact.tagName}"`,
          tag: 'COMPONENT',
          hint: 'Give each component in the file a unique custom element name.',
        };
        errors.push(addNodeLocation(error, child));
        continue;
      }
      if (componentClassNames.has(compileResult.artifact.className)) {
        const error: CompilerError = {
          type: 'validation',
          message: `Component name "${compileResult.artifact.tagName}" generates duplicate class name "${compileResult.artifact.className}"`,
          tag: 'COMPONENT',
          hint: 'Choose names that remain different when converted to PascalCase.',
        };
        errors.push(addNodeLocation(error, child));
        continue;
      }
      componentNames.add(compileResult.artifact.tagName);
      componentClassNames.add(compileResult.artifact.className);
      artifacts.push(compileResult.artifact);
    }
    componentSnippets.push(...compileResult.codeSnippets);
  }

  if (errors.length > 0 && options.strictMode) {
    return { success: false, errors, warnings, components: [] };
  }

  const preludes: string[] = [];
  if (requiresRuntime) {
    preludes.push(ensureRuntime());
  }
  if (usesBlocks) {
    preludes.push(BLOCK_RUNTIME);
  }

  const classNames = artifacts.map((artifact) => artifact.className);
  const format = options.outputFormat ?? 'esm';
  if (format === 'esm') {
    componentSnippets.push(`export { ${classNames.join(', ')} };`);
  } else if (format === 'cjs') {
    componentSnippets.push(`module.exports = { ${classNames.join(', ')} };`);
  } else {
    componentSnippets.push(
      `globalThis.HTMSComponents = Object.assign(globalThis.HTMSComponents || {}, { ${classNames.join(', ')} });`
    );
  }

  const body = componentSnippets.join('\n\n');
  const joinedCode = [...preludes, body].join('\n\n');
  if (!joinedCode.trim()) {
    errors.push({
      type: 'runtime',
      message: 'Component compilation produced no output',
    });
    return { success: false, errors, warnings, components: [] };
  }

  return {
    success: errors.length === 0,
    code: joinedCode,
    preludes,
    body,
    components: artifacts,
    errors,
    warnings,
  };
}

interface ComponentCompileInternalResult {
  codeSnippets: string[];
  errors: CompilerError[];
  warnings: CompilerWarning[];
  requiresRuntime: boolean;
  usesBlocks?: boolean;
  artifact?: ComponentArtifact;
}

function compileComponentElement(
  element: SourceElement,
  options: ParseOptions
): ComponentCompileInternalResult {
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];

  const metadata = readComponentMetadata(element, errors, warnings);
  if (!metadata) {
    addNodeLocations(errors, element);
    addNodeLocations(warnings, element);
    return { codeSnippets: [], errors, warnings, requiresRuntime: false };
  }

  const componentFields = collectComponentFields(element, metadata);
  const {
    ir: renderIR,
    errors: renderErrors,
    warnings: renderWarnings,
  } = elementsToComponentCode(
    element,
    RENDER_TARGET_VAR,
    options,
    componentFields
  );

  errors.push(...renderErrors);
  warnings.push(...renderWarnings);

  const summary = summarizeComponent(renderIR);
  const inputNames = new Set(metadata.inputs.map((input) => input.propName));
  for (const stateName of summary.initialStateRoots) {
    if (conflictsWithElement(stateName)) {
      errors.push({
        type: 'validation',
        message: `Component state "${stateName}" conflicts with the custom element runtime`,
        tag: 'COMPONENT',
      });
    } else if (inputNames.has(stateName)) {
      errors.push({
        type: 'validation',
        message: `Component field "${stateName}" cannot be both a prop and local state`,
        tag: 'COMPONENT',
      });
    }
  }

  const stateRoots = new Set(summary.initialStateRoots);
  const methodNames = new Set<string>();
  for (const method of summary.methods) {
    if (conflictsWithElement(method.name)) {
      errors.push({
        type: 'validation',
        message: `Method "${method.name}" conflicts with the custom element runtime`,
        tag: 'FUNCTION',
        hint: 'Choose a name that is not an HTMLElement property, e.g. "save" rather than "click".',
      });
    } else if (inputNames.has(method.name) || stateRoots.has(method.name)) {
      errors.push({
        type: 'validation',
        message: `Method "${method.name}" has the same name as a prop or state field`,
        tag: 'FUNCTION',
      });
    } else if (methodNames.has(method.name)) {
      errors.push({
        type: 'validation',
        message: `Duplicate method "${method.name}"`,
        tag: 'FUNCTION',
      });
    }
    methodNames.add(method.name);
  }

  addNodeLocations(errors, element);
  addNodeLocations(warnings, element);

  if (options.strictMode && errors.length > 0) {
    return { codeSnippets: [], errors, warnings, requiresRuntime: false };
  }

  const { code: classCode, usesBlocks } = buildComponentClass(
    metadata,
    renderIR,
    summary,
    componentFields,
    options.renderer === 'legacy' ? null : element.ownerDocument
  );
  const registrationCode = `if (!customElements.get('${metadata.tagName}')) {\n  customElements.define('${metadata.tagName}', ${metadata.className});\n}`;

  CompilerLogger.logInfo('Component compiled', {
    component: metadata.tagName,
    className: metadata.className,
    shadowMode: metadata.shadowMode,
  });

  return {
    codeSnippets: [classCode, registrationCode],
    errors,
    warnings,
    requiresRuntime: summary.requiresRuntime,
    usesBlocks,
    artifact: {
      name: metadata.tagName,
      className: metadata.className,
      tagName: metadata.tagName,
      shadowMode: metadata.shadowMode,
      inputs: metadata.inputs.map((input) => ({ ...input })),
      events: summary.emittedEvents.map((name) => ({ name })),
      methods: summary.methods.map((method) => ({
        name: method.name,
        params: [...method.params],
        async: method.async,
      })),
      code: [classCode, registrationCode].join('\n\n'),
    },
  };
}

// Field-declaring tags and the attribute holding the declared path. Only
// the root segment becomes a component field.
const FIELD_DECLARATIONS: Array<[string, string]> = [
  ['var', 'name'],
  ['derive', 'name'],
  ['function', 'name'],
  ['object', 'name'],
  ['array', 'name'],
  ['set', 'name'],
  ['push', 'array'],
  ['splice', 'array'],
  ['model', 'path'],
  ['model', 'name'],
  ['fetch', 'into'],
  ['fetch', 'error'],
  ['fetch', 'loading'],
];

const IDENTIFIER_ROOT = /^(?:this\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)/;

// Collects the names that bare identifiers in component expressions refer
// to, before any tag handler runs: props, state, derived values and
// methods. Built-in helpers are included so `$('#id')` works unqualified.
function collectComponentFields(
  element: SourceElement,
  metadata: ComponentMetadata
): Set<string> {
  const fields = new Set<string>(BUILTIN_COMPONENT_FIELDS);
  for (const input of metadata.inputs) {
    fields.add(input.propName);
  }
  const addRoot = (value: string | null): void => {
    const match = value ? IDENTIFIER_ROOT.exec(value.trim()) : null;
    if (match && match[1] !== 'this') {
      fields.add(match[1]);
    }
  };
  // One walk over the component: declaring tags contribute the declared
  // path's root, and bind: attributes on any element contribute theirs.
  for (const node of element.descendants()) {
    if (!(node instanceof SourceElement)) continue;
    for (const [tagName, attribute] of FIELD_DECLARATIONS) {
      if (node.localName === tagName) addRoot(node.getAttribute(attribute));
    }
    for (const attr of node.attrs) {
      if (attr.name.startsWith('bind:')) addRoot(attr.value);
    }
  }
  return fields;
}

function readComponentMetadata(
  element: SourceElement,
  errors: CompilerError[],
  warnings: CompilerWarning[]
): ComponentMetadata | null {
  const nameAttr = element.getAttribute('name');
  if (!nameAttr) {
    errors.push({
      type: 'validation',
      message: '<component> requires a "name" attribute',
      hint: 'Add a custom element name such as name="click-counter".',
    });
    return null;
  }

  const tagName = nameAttr.trim().toLowerCase();
  if (!VALID_CUSTOM_ELEMENT_NAME.test(tagName)) {
    errors.push({
      type: 'validation',
      message: `Component name "${tagName}" must include a hyphen and be a valid custom element name`,
      hint: 'Custom element names need a hyphen, for example "click-counter".',
    });
    return null;
  }

  const nameValidationErrors = SecurityValidator.validateHtmlAttribute(
    'component',
    tagName
  );
  if (nameValidationErrors.length > 0) {
    errors.push(...nameValidationErrors);
    return null;
  }

  const className = toClassName(tagName);

  const shadowAttr = (element.getAttribute('shadow') || 'open').toLowerCase();
  if (!SHADOW_MODES.has(shadowAttr)) {
    warnings.push({
      message: `Invalid shadow mode "${shadowAttr}" on component "${tagName}". Defaulting to "open".`,
      tag: 'COMPONENT',
    });
  }
  const shadowMode = SHADOW_MODES.has(shadowAttr)
    ? (shadowAttr as 'open' | 'closed' | 'none')
    : 'open';

  const props = parseComponentProps(element.getAttribute('props'), errors);
  const explicitObservedAttributes = parseAttributeList(
    element.getAttribute('observed'),
    errors
  );
  const inputs = resolveComponentInputs(
    props,
    explicitObservedAttributes,
    errors
  );
  const observedAttributes = Array.from(
    new Set([
      ...explicitObservedAttributes,
      ...props.map((prop) => toAttributeName(prop.propName)),
    ])
  );

  return {
    tagName,
    className,
    shadowMode,
    props,
    observedAttributes,
    inputs,
  };
}

function toClassName(tagName: string): string {
  const segments = tagName.split(/[-_]/).filter(Boolean);
  const pascal = segments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `${pascal || 'Component'}Component`;
}

function parseComponentProps(
  value: string | null,
  errors: CompilerError[]
): ComponentProperty[] {
  if (!value) return [];
  const properties: ComponentProperty[] = [];
  const seen = new Set<string>();

  for (const raw of value.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const [rawName, rawType = 'string', ...extra] = trimmed.split(':');
    const propName = rawName.trim();
    const type = rawType.trim().toLowerCase();
    const idErrors = SecurityValidator.validateJavaScriptIdentifier(propName);
    if (idErrors.length > 0) {
      errors.push(
        ...idErrors.map((error) => ({
          ...error,
          message: `property "${propName}" is invalid: ${error.message}`,
        }))
      );
      continue;
    }

    if (conflictsWithElement(propName)) {
      errors.push({
        type: 'validation',
        message: `Property "${propName}" conflicts with the component runtime`,
        tag: 'COMPONENT',
      });
      continue;
    }

    if (
      extra.length > 0 ||
      !COMPONENT_INPUT_TYPES.has(type as ComponentInputType)
    ) {
      errors.push({
        type: 'validation',
        message: `Property "${propName}" has unsupported type "${type}". Expected string, number, boolean, or json`,
        tag: 'COMPONENT',
      });
      continue;
    }

    if (seen.has(propName)) {
      errors.push({
        type: 'validation',
        message: `Duplicate component property "${propName}"`,
        tag: 'COMPONENT',
      });
      continue;
    }

    seen.add(propName);
    properties.push({ propName, type: type as ComponentInputType });
  }

  return properties;
}

function parseAttributeList(
  value: string | null,
  errors: CompilerError[]
): string[] {
  if (!value) return [];
  const attrs = new Set<string>();
  for (const raw of value.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const validationErrors = SecurityValidator.validateHtmlAttribute(
      trimmed,
      ''
    );
    if (validationErrors.length > 0) {
      errors.push(
        ...validationErrors.map((error) => ({
          ...error,
          message: `Observed attribute "${trimmed}" is invalid: ${error.message}`,
        }))
      );
      continue;
    }
    attrs.add(trimmed);
  }
  return Array.from(attrs);
}

function toAttributeName(propName: string): string {
  return propName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function toPropertyName(attributeName: string): string {
  return attributeName.replace(/-([a-z0-9])/g, (_, char: string) =>
    char.toUpperCase()
  );
}

function resolveComponentInputs(
  props: ComponentProperty[],
  observedAttributes: string[],
  errors: CompilerError[]
): ComponentInput[] {
  const inputs = new Map<string, ComponentInput>();

  for (const prop of props) {
    inputs.set(prop.propName, {
      propName: prop.propName,
      attributeName: toAttributeName(prop.propName),
      type: prop.type,
    });
  }

  for (const attributeName of observedAttributes) {
    const matchingProp = props.find(
      (prop) =>
        prop.propName === attributeName ||
        toAttributeName(prop.propName) === attributeName
    );
    const propName = matchingProp?.propName ?? toPropertyName(attributeName);
    const propErrors = SecurityValidator.validateJavaScriptIdentifier(propName);

    if (propErrors.length > 0) {
      errors.push(
        ...propErrors.map((error) => ({
          ...error,
          message: `Observed attribute "${attributeName}" cannot be reflected to property "${propName}": ${error.message}`,
        }))
      );
      continue;
    }

    if (conflictsWithElement(propName)) {
      errors.push({
        type: 'validation',
        message: `Observed attribute "${attributeName}" maps to reserved property "${propName}"`,
        tag: 'COMPONENT',
      });
      continue;
    }

    const existing = inputs.get(propName);
    if (existing) {
      existing.attributeName = attributeName;
    } else {
      inputs.set(propName, { propName, attributeName, type: 'string' });
    }
  }

  return Array.from(inputs.values());
}

// The variable render() fills before the reconciling renderer applies it to
// the root.
const RENDER_TARGET_VAR = 'componentRoot';

function buildComponentClass(
  metadata: ComponentMetadata,
  renderIR: ComponentIR,
  summary: ComponentSummary,
  componentFields: ReadonlySet<string>,
  blockDocument: SourceDocument | null
): { code: string; usesBlocks: boolean } {
  const fields = Array.from(
    new Set([
      ...metadata.inputs.map((input) => input.propName),
      ...summary.stateRoots,
      ...summary.methods.map((method) => method.name),
      ...componentFields,
    ])
  );
  const inputNames = new Set(metadata.inputs.map((input) => input.propName));
  const reactiveStateRoots = summary.initialStateRoots.filter(
    (name) => !inputNames.has(name)
  );
  const context: RenderContext = { counter: { value: 0 }, fields };

  const methodBodies = new Map<string, MethodCode>();
  for (const method of summary.methods) {
    const bodyLines = method.body.flatMap((directive) =>
      renderDirective(
        directive,
        '(this.__htmsRoot || this)',
        '      ',
        method.params,
        context
      )
    );
    methodBodies.set(method.name, {
      params: method.params,
      body: bodyLines.join('\n'),
    });
  }

  const shared: SharedClassInput = {
    metadata,
    summary,
    methodBodies,
    reactiveStateRoots,
    lifecycleSection: lifecycleSection(metadata),
    shadowInit:
      metadata.shadowMode === 'none' ? `    this.__htmsRoot = this;` : '',
  };

  if (blockDocument) {
    const analyzer = createAnalyzer(
      renderIR,
      reactiveStateRoots,
      inputNames,
      summary.lifecycleState,
      methodBodies
    );
    // Register derive reads before block compilation resolves write masks.
    // Effects and fetches can be the only consumers of a derived field, so
    // their reads would otherwise be absent when a state helper's mask is
    // finalized.
    const deriveMasks = analyzeDeriveMasks(analyzer, summary.lifecycleState);
    // Handlers' write masks depend on which fields bindings read, which the
    // block compiler only knows once every binding is compiled; it resolves
    // these placeholders at the end.
    const stateMasks: StateMasks = (path, elementWrite) =>
      `@@state:${elementWrite ? 1 : 0}:${path
        .map((segment) => encodeURIComponent(segment).replace(/\./g, '%2E'))
        .join('.')}@@`;
    try {
      const plan = compileBlockComponent(renderIR, {
        className: metadata.className,
        document: blockDocument,
        componentFields: fields,
        analyzer,
        renderEventBody: (directive, eventRootVar, scopeVars) =>
          renderEventBody(
            directive,
            eventRootVar,
            scopeVars,
            context,
            stateMasks
          ),
      });
      return {
        code: buildBlockComponentClass(shared, plan, analyzer, deriveMasks),
        usesBlocks: true,
      };
    } catch (error) {
      if (!(error instanceof UnsupportedBlockFeature)) {
        throw error;
      }
      CompilerLogger.logDebug('Component uses the reconciling renderer', {
        component: metadata.tagName,
        reason: error.message,
      });
    }
  }
  return {
    code: buildReconcilingComponentClass(shared, renderIR, context),
    usesBlocks: false,
  };
}

// What both renderers' classes are built from.
interface SharedClassInput {
  metadata: ComponentMetadata;
  summary: ComponentSummary;
  methodBodies: ReadonlyMap<string, MethodCode>;
  reactiveStateRoots: readonly string[];
  lifecycleSection: string;
  shadowInit: string;
}

function lifecycleSection(metadata: ComponentMetadata): string {
  const extras: string[] = [];
  if (metadata.observedAttributes.length > 0) {
    extras.push(
      `  static get observedAttributes() { return ${JSON.stringify(metadata.observedAttributes)}; }`,
      ATTRIBUTE_CHANGED_CALLBACK
    );
  }
  return extras.length > 0 ? `\n\n${extras.join('\n\n')}\n` : '\n';
}

function inputHelperMembers(metadata: ComponentMetadata): string {
  if (metadata.inputs.length === 0) return '';
  return inputHelpers(
    Object.fromEntries(
      metadata.inputs.map((input) => [
        input.attributeName,
        { propName: input.propName, type: input.type },
      ])
    )
  );
}

function renderRootMember(metadata: ComponentMetadata): string {
  return metadata.shadowMode === 'none'
    ? ''
    : renderRootHelper(metadata.shadowMode);
}

// A method whose only writes go through setters needs no follow-up; one
// that changes state objects in place reports the fields it may have
// touched. Without the analysis every method reports everything.
function methodMembers(
  input: SharedClassInput,
  analyzer: DependencyAnalyzer | null
): string {
  return input.summary.methods
    .map((method) => {
      const body = input.methodBodies.get(method.name)?.body ?? '';
      const header = `  ${method.async ? 'async ' : ''}${method.name}(${method.params.join(', ')}) {`;
      const mask = analyzer ? analyzer.methodWriteMask(method.name) : ALL_DIRTY;
      if (mask === 0) {
        return `${header}
${body.replace(/^ {2}/gm, '')}
  }

`;
      }
      return `${header}
    try {
${body}
    } finally {
      this.__htmsAfterMethod(${mask === ALL_DIRTY ? '' : mask});
    }
  }

`;
    })
    .join('');
}

// Constructor lines defining the state and input accessors. A field's bit
// marks it dirty; a field nothing rendered reads (outside `usedMask`)
// schedules no render.
function propertyInitialization(
  input: SharedClassInput,
  analyzer: DependencyAnalyzer | null,
  usedMask: number
): { state: string; inputs: string } {
  const bit = (name: string): number =>
    analyzer ? analyzer.bit(name) : ALL_DIRTY;
  const state = input.reactiveStateRoots
    .map((name) => {
      const stateBit = bit(name);
      return `    this.__htmsDefineStateProperty(${JSON.stringify(name)}, ${stateBit}, ${(stateBit & usedMask) !== 0});`;
    })
    .join('\n');
  const inputs = input.metadata.inputs
    .map(({ propName, attributeName, type }) => {
      const inputBit = bit(propName);
      return `    this.__htmsDefineInputProperty(${JSON.stringify(propName)}, ${JSON.stringify(attributeName)}, ${JSON.stringify(type)}, ${inputBit}, ${(inputBit & usedMask) !== 0});`;
    })
    .join('\n');
  return { state, inputs };
}

function buildReconcilingComponentClass(
  input: SharedClassInput,
  renderIR: ComponentIR,
  context: RenderContext
): string {
  const { metadata, summary } = input;
  const { fields } = context;
  const hasEvents = summary.hasEvents;
  const preservesFocus =
    metadata.inputs.length > 0 || summary.hasState || summary.hasBindings;
  const templateHTML = templateNodesToHTML(renderIR.templateNodes);
  const hasStaticTemplate =
    templateHTML.trim().length > 0 &&
    !templateNodesHaveInterpolations(renderIR.templateNodes, [], fields) &&
    !templateNodesHaveDirectives(renderIR.templateNodes);

  const renderLines: string[] = [
    `    const root = this.__htmsRoot || this;`,
    `    if (!root) {`,
    `      throw new Error('Component root not initialized');`,
    `    }`,
    `    const ${RENDER_TARGET_VAR} = document.createDocumentFragment();`,
  ];
  if (preservesFocus) {
    renderLines.push(
      `    const __htmsFocusSnapshot = this.__htmsSnapshotFocus(root, ${JSON.stringify(summary.controlledSelectors)});`
    );
  }
  if (hasEvents) {
    renderLines.push(`    this.__htmsCleanupRenderListeners();`);
  }
  for (const directive of summary.lifecycleState.init) {
    renderLines.push(...renderStateDirective(directive, '    '));
  }
  for (const directive of summary.lifecycleState.derive) {
    renderLines.push(...renderStateDirective(directive, '    '));
  }
  if (hasStaticTemplate) {
    renderLines.push(
      `    const staticFragment = ${metadata.className}.__htmsTemplate.content.cloneNode(true);`,
      `    ${RENDER_TARGET_VAR}.appendChild(staticFragment);`
    );
  } else {
    const templateStatements = serializeTemplateNodes(
      renderIR.templateNodes,
      RENDER_TARGET_VAR,
      [],
      fields,
      (directive, targetVar) =>
        renderDirective(directive, targetVar, '', [], context),
      context.counter
    );
    for (const line of templateStatements.split('\n')) {
      if (line.trim().length > 0) renderLines.push(`    ${line}`);
    }
  }
  for (const directive of renderIR.directives) {
    renderLines.push(
      ...renderDirective(directive, RENDER_TARGET_VAR, '    ', [], context)
    );
  }
  renderLines.push(
    `    this.__htmsReconcileChildren(root, ${RENDER_TARGET_VAR});`
  );
  if (preservesFocus) {
    renderLines.push(`    this.__htmsRestoreFocus(root, __htmsFocusSnapshot);`);
  }
  const renderBody = renderLines.map((line) => `  ${line}`).join('\n');

  const members = [
    hasStaticTemplate ? staticTemplateGetter(templateHTML) : '',
    methodMembers(input, null),
    inputHelperMembers(metadata),
    summary.hasState ? STATE_HELPERS : '',
    UPDATE_HELPERS,
    hasEvents ? `${LEGACY_LISTENER_HELPERS}${SHARED_EVENT_HELPERS}` : '',
    reconciliationHelpers(hasEvents),
    renderRootMember(metadata),
    preservesFocus ? FOCUS_HELPERS : '',
  ].join('');
  const { state, inputs } = propertyInitialization(input, null, ALL_DIRTY);

  return finalizeStateStorage(`class ${metadata.className} extends HTMLElement {
${members}  constructor() {
${CONSTRUCTOR_START}${hasEvents ? `    this.__htmsRenderCleanups = [];\n    this.__htmsTimers = new Map();\n` : ''}
${input.shadowInit}
${state ? `${state}\n` : ''}${inputs ? `${inputs}\n` : ''}  }

  connectedCallback() {
${metadata.shadowMode === 'none' ? '' : ENSURE_RENDER_ROOT}    this.__htmsConnected = true;
    this.render();
  }${input.lifecycleSection}

  disconnectedCallback() {
${DISCONNECT_START}${hasEvents ? `    this.__htmsCleanupRenderListeners();\n    this.__htmsClearTimers();\n` : ''}
${DISPOSE_EFFECTS}  }

${renderMethod(renderBody)}
}`);
}

function guardDerivedLines(
  lines: string | readonly string[],
  mask: number | null
): string[] {
  const body = typeof lines === 'string' ? [lines] : lines;
  if (mask === null) return [...body];
  const condition = mask === 0 ? 'false' : `(this.__htmsDirty & ${mask}) !== 0`;
  return [
    `if (this.__htmsDirty === -1 || ${condition}) {`,
    ...body.map((line) => `  ${line}`),
    '}',
  ];
}

function analyzeDeriveMasks(
  analyzer: DependencyAnalyzer,
  lifecycleState: { init: StateDirective[]; derive: StateDirective[] }
): Array<number | null> {
  return lifecycleState.derive.map((directive) => {
    const expression = directive.value ?? 'undefined';
    const root = directive.path[0];
    // Always register the read, even when the expression cannot be proven
    // pure. Its state dependencies still determine handler/effect masks.
    const sourceMask = analyzer.readMask(expression, new Map(), true);
    if (!isPureExpression(expression) || root === undefined) return null;
    const targetMask = analyzer.bit(root);
    // A nested write carries DEEP_BIT. Include it for any state-dependent
    // derive, conservatively covering object paths and derived chains.
    if (sourceMask === ALL_DIRTY || targetMask === ALL_DIRTY) return null;
    const mask = sourceMask | targetMask;
    return mask === 0 ? 0 : mask | DEEP_BIT;
  });
}

// Builds the dependency analyser for a block component: reactive fields get
// bits, derived values carry their expressions, and every assignment in the
// component is scanned for fields that may share objects.
function createAnalyzer(
  renderIR: ComponentIR,
  reactiveStateRoots: readonly string[],
  inputNames: ReadonlySet<string>,
  lifecycleState: { init: StateDirective[]; derive: StateDirective[] },
  methodBodies: ReadonlyMap<string, MethodCode>
): DependencyAnalyzer {
  // A derived value's readers depend on what its expression reads. Several
  // derives into one root (`stats.total`, `stats.count`) are combined.
  const derived = new Map<string, string>();
  for (const directive of lifecycleState.derive) {
    const [root] = directive.path;
    if (root === undefined) continue;
    const value = directive.value ?? 'undefined';
    const existing = derived.get(root);
    derived.set(
      root,
      existing === undefined ? value : `(${existing}, ${value})`
    );
  }
  const analyzer = new DependencyAnalyzer({
    reactive: [...reactiveStateRoots, ...inputNames],
    derived,
    methods: methodBodies,
  });
  const initialValues = new Map<string, string>();
  for (const directive of lifecycleState.init) {
    const [root] = directive.path;
    if (root !== undefined && directive.value !== undefined) {
      initialValues.set(root, directive.value);
    }
  }
  collectAliases(renderIR, analyzer, initialValues);
  analyzer.seal();
  return analyzer;
}

// A class member's first line: its name is the first group.
const MEMBER_START = /^ {2}(?:static |get |set |async )*([$\w]+)\(/gm;

// State and input values live in fast-mode store objects (a null-prototype
// object is a slow dictionary in V8, an object created from one is not).
// Reactive state becomes class accessors over that store, so reads in
// render code are monomorphic property loads instead of calls to
// per-instance closures. A state name that collides with another class
// member keeps the per-instance property.
function finalizeStateStorage(classCode: string): string {
  const header = /^class ([$\w]+) extends HTMLElement \{\n/.exec(classCode);
  if (!header) return classCode;
  const className = header[1];
  const members = new Set<string>();
  for (const match of classCode.matchAll(MEMBER_START)) {
    members.add(match[1]);
  }
  const accessors: string[] = [];
  const code = classCode
    .replace(/__HTMS_CLASS__/g, className)
    .replace(
      /^ {4}this\.__htmsDefineStateProperty\(("[$\w]+"), (-?\d+), (true|false)\);$/gm,
      (line, quoted: string, bit: string, rendered: string) => {
        const name = JSON.parse(quoted) as string;
        if (
          members.has(name) ||
          name === 'constructor' ||
          name === '__proto__'
        ) {
          return line;
        }
        // The setter marks the field dirty and, when something rendered
        // reads it, schedules a render.
        const mark = `      this.__htmsDirty |= ${bit};\n`;
        const request =
          rendered === 'false'
            ? ''
            : '      if (!this.__htmsRendering) this.__htmsRequestRender();\n';
        accessors.push(
          `  get ${name}() {\n    return this.__htmsState.${name};\n  }\n\n  set ${name}(value) {\n    if (!Object.is(this.__htmsState.${name}, value)) {\n      this.__htmsState.${name} = value;\n${mark}${request}    }\n  }\n`
        );
        return `    this.__htmsAdoptState(${quoted});`;
      }
    );
  const store = `  static __htmsStore() {\n    return this.__htmsStoreProto || (this.__htmsStoreProto = Object.create(null));\n  }\n`;
  return code.replace(
    header[0],
    `${header[0]}${store}\n${accessors.map((accessor) => `${accessor}\n`).join('')}`
  );
}

const HELPER_WORD = /(?<!\w)__htms\w*/g;

// Drops internal `__htms*` methods nothing reachable calls. Public members
// and lifecycle callbacks are the roots; a helper is kept when a kept member
// mentions it.
function pruneUnusedHelpers(classCode: string): string {
  // Each member runs from the start of its first line to the start of the
  // next member's; the last one stops before the class's closing line.
  const chunks: Array<{ name: string; from: number; to: number }> = [];
  for (const match of classCode.matchAll(MEMBER_START)) {
    const previous = chunks.at(-1);
    if (previous) previous.to = match.index;
    chunks.push({ name: match[1], from: match.index, to: 0 });
  }
  const last = chunks.at(-1);
  if (last) last.to = classCode.lastIndexOf('\n') + 1;
  // A helper is kept when its name appears as a whole word in code that is
  // itself kept. Words are collected once per kept chunk instead of
  // re-scanning the growing text with a regular expression per helper.
  const kept = new Set<number>();
  const words = new Set<string>();
  // Only `__htms…` helpers are candidates, so only those words are kept.
  const reach = (from: number, to: number): void => {
    HELPER_WORD.lastIndex = from;
    let match = HELPER_WORD.exec(classCode);
    while (match && match.index < to) {
      words.add(match[0]);
      match = HELPER_WORD.exec(classCode);
    }
  };
  reach(0, chunks[0]?.from ?? classCode.length);
  chunks.forEach((chunk, index) => {
    if (!chunk.name.startsWith('__htms')) {
      kept.add(index);
      reach(chunk.from, chunk.to);
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    chunks.forEach((chunk, index) => {
      if (kept.has(index)) return;
      if (words.has(chunk.name)) {
        kept.add(index);
        reach(chunk.from, chunk.to);
        changed = true;
      }
    });
  }
  let output = '';
  let cursor = 0;
  chunks.forEach((chunk, index) => {
    if (kept.has(index)) return;
    output += classCode.slice(cursor, chunk.from);
    cursor = chunk.to;
  });
  return output + classCode.slice(cursor);
}

function buildBlockComponentClass(
  input: SharedClassInput,
  plan: BlockComponentPlan,
  analyzer: DependencyAnalyzer,
  deriveMasks: readonly (number | null)[]
): string {
  const { metadata, summary } = input;
  const className = metadata.className;
  const delegated = plan.delegatedEvents;
  const hasListeners = plan.hasHandlers || plan.globalListeners.length > 0;
  const stateMasks: StateMasks = (path, elementWrite) =>
    analyzer.stateWriteMask(path, elementWrite);

  const methods = methodMembers(input, analyzer);
  const { state, inputs } = propertyInitialization(
    input,
    analyzer,
    plan.usedMask
  );

  const renderLines: string[] = [];
  // Initial values are only missing before the first render.
  if (summary.lifecycleState.init.length > 0) {
    renderLines.push('if (!this.__htmsBlock) {');
    for (const directive of summary.lifecycleState.init) {
      renderLines.push(...renderStateDirective(directive, '  ', stateMasks));
    }
    renderLines.push('}');
  }
  summary.lifecycleState.derive.forEach((directive, index) => {
    const [root] = directive.path;
    const mask = deriveMasks.at(index) ?? null;
    if (directive.path.length === 1 && root !== undefined) {
      // A root path needs no resolving.
      const target = /^[A-Za-z_$][\w$]*$/.test(root)
        ? `this.${root}`
        : `this[${JSON.stringify(root)}]`;
      renderLines.push(
        ...guardDerivedLines(
          `${target} = (${directive.value ?? 'undefined'});`,
          mask
        )
      );
    } else {
      renderLines.push(
        ...guardDerivedLines(
          renderStateDirective(directive, '', stateMasks),
          mask
        )
      );
    }
  });
  // The fields changed since the last render; the update skips bindings
  // none of them can affect. Changes made while rendering wait for the
  // next render.
  renderLines.push(
    'const $$d = this.__htmsDirty;',
    'this.__htmsDirty = 0;',
    'if (this.__htmsBlock) {',
    '  if ($$d !== 0) this.__htmsU0(this.__htmsBlock, $$d);',
    '} else {',
    '  this.__htmsMount(this.__htmsRoot || this);',
    '}'
  );
  if (plan.globalListeners.length > 0) {
    renderLines.push(
      'if (!this.__htmsGlobalsBound) {',
      '  this.__htmsGlobalsBound = true;',
      ...plan.globalListeners.map((line) => `  ${line}`),
      '}'
    );
  }
  renderLines.push(...plan.statements.filter((line) => line.trim().length > 0));
  const renderBody = renderLines.map((line) => `      ${line}`).join('\n');

  const mount = `  __htmsMount(root) {
    const template = ${className}.__htmsT0();
    let hydrate = false;
    if (root.firstChild) {
      // Server-rendered markup with the template's shape is adopted in
      // place; anything else is replaced.
      __htmsStrip(root);
      hydrate = __htmsSame(root, template);
      if (!hydrate) {
        root.textContent = '';
      }
    }
    const container = hydrate ? root : template.cloneNode(true);
    this.__htmsBlock = this.__htmsC0(container, hydrate);
    if (!hydrate) {
      root.appendChild(container);
    }
  }

`;

  const delegatedListeners = (method: string): string =>
    delegated.length > 0
      ? `    for (const type of ${JSON.stringify(delegated)}) {\n      (this.__htmsRoot || this).${method}(type, this.__htmsD);\n      (this.__htmsRoot || this).${method}(type, this.__htmsD, true);\n    }\n`
      : '';

  const sections = [
    methods,
    inputHelperMembers(metadata),
    summary.hasState ? STATE_HELPERS : '',
    UPDATE_HELPERS,
    renderRootMember(metadata),
  ];
  const generated = [plan.members, ...sections, renderBody].join('\n');
  const usesTimers = generated.includes('__htmsDebounce(');
  const usesGlobals = plan.globalListeners.length > 0;

  return pruneUnusedHelpers(
    finalizeStateStorage(`class ${className} extends HTMLElement {
${plan.members}
${sections.join('')}${hasListeners ? SHARED_EVENT_HELPERS : ''}${mount}  constructor() {
${CONSTRUCTOR_START}    this.__htmsBlock = null;
${usesGlobals ? `    this.__htmsRenderCleanups = [];\n    this.__htmsGlobalsBound = false;\n` : ''}${usesTimers ? `    this.__htmsTimers = new Map();\n` : ''}${delegated.length > 0 ? `    this.__htmsEventBlocks = new WeakMap();\n    this.__htmsD = (event) => __htmsDispatch(this, event);\n` : ''}${input.shadowInit ? `${input.shadowInit}\n` : ''}${state ? `${state}\n` : ''}${inputs ? `${inputs}\n` : ''}  }

  connectedCallback() {
${metadata.shadowMode === 'none' ? '' : ENSURE_RENDER_ROOT}    this.__htmsConnected = true;
${delegatedListeners('addEventListener')}    this.render();
  }${input.lifecycleSection}
  disconnectedCallback() {
${DISCONNECT_START}${delegatedListeners('removeEventListener')}${usesGlobals ? `    this.__htmsCleanupRenderListeners();\n    this.__htmsGlobalsBound = false;\n` : ''}${usesTimers ? `    this.__htmsClearTimers();\n` : ''}${DISPOSE_EFFECTS}  }

${renderMethod(renderBody)}
}`)
  );
}
