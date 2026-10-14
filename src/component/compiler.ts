import { parseComponentSource } from './source-parser';
import { elementsToComponentCode } from './renderer';
import {
  BLOCK_RUNTIME,
  BlockComponentPlan,
  UnsupportedBlockFeature,
  compileBlockComponent,
} from './block-compiler';
import {
  ComponentIR,
  DirectiveNode,
  LoopDirective,
  ConditionDirective,
  EventDirective,
  VisibilityDirective,
  AttributeDirective,
  AppendDirective,
  BindDirective,
  KeyedListDirective,
  SwitchDirective,
  WhileDirective,
  ClassDirective,
  StyleDirective,
  StateDirective,
  TemplateNode,
  MethodDirective,
  walkComponentIR,
  walkDirectives,
  walkTemplateElements,
} from './ir';
import {
  renderEventPreamble,
  serializeTemplateNodes,
  URL_ATTRIBUTES,
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

function collectEmittedEventNames(ir: ComponentIR): string[] {
  const names = new Set<string>();
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'statement' && directive.emittedEventName) {
      names.add(directive.emittedEventName);
    }
  });
  return Array.from(names);
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

function isReservedComponentProperty(name: string): boolean {
  return name.startsWith('__htms') || RESERVED_COMPONENT_PROPERTIES.has(name);
}

function isNativeElementProperty(element: Element, name: string): boolean {
  return name in element;
}

function containsState(ir: ComponentIR): boolean {
  let found = false;
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'state') {
      found = true;
    }
  });
  return found;
}

function containsEvent(ir: ComponentIR): boolean {
  let found = false;
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'event') {
      found = true;
    }
  });
  walkTemplateElements(ir, (node) => {
    if (
      node.bindings?.some(
        (binding) => binding.kind === 'event' || binding.kind === 'model'
      )
    ) {
      found = true;
    }
  });
  return found;
}

function containsBindings(ir: ComponentIR): boolean {
  let found = false;
  walkTemplateElements(ir, (node) => {
    if ((node.bindings?.length ?? 0) > 0) {
      found = true;
    }
  });
  return found;
}

function collectMethods(ir: ComponentIR): MethodDirective[] {
  const methods: MethodDirective[] = [];
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'method') {
      methods.push(directive);
    }
  });
  return methods;
}

function containsRuntimeDependency(ir: ComponentIR): boolean {
  let found = false;
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'statement' && directive.requiresRuntime) {
      found = true;
    }
  });
  return found;
}

function collectControlledSelectors(ir: ComponentIR): string[] {
  const selectors = new Set<string>();
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'bind') {
      selectors.add(directive.selector);
    }
    if (directive.kind === 'attribute' && directive.target === 'property') {
      selectors.add(directive.selector);
    }
  });
  return Array.from(selectors);
}

function collectStateRoots(ir: ComponentIR): string[] {
  const roots = new Set<string>();
  walkComponentIR(ir, (directive) => {
    if (directive.kind === 'state' && directive.path.length > 0) {
      roots.add(directive.path[0]);
    }
  });
  return Array.from(roots);
}

function collectInitialStateRoots(ir: ComponentIR): string[] {
  const roots = new Set<string>();
  walkComponentIR(ir, (directive) => {
    if (
      directive.kind === 'state' &&
      directive.mode === 'init' &&
      directive.path.length > 0
    ) {
      roots.add(directive.path[0]);
    }
  });
  return Array.from(roots);
}

// State init/derive directives can appear anywhere in the IR (top level,
// inside branches, or embedded in markup). They are hoisted to the top of
// render() so declared state is initialized before any template uses it.
function collectLifecycleStateDirectives(ir: ComponentIR): {
  init: StateDirective[];
  derive: StateDirective[];
} {
  const init: StateDirective[] = [];
  const derive: StateDirective[] = [];
  walkComponentIR(ir, (directive) => {
    if (directive.kind !== 'state') {
      return;
    }
    if (directive.mode === 'init') {
      init.push(directive);
    } else if (directive.mode === 'derive') {
      derive.push(directive);
    }
  });
  return { init, derive };
}

export function compileComponents(
  htmlContent: string,
  options: ParseOptions = {}
): ComponentCompileResult {
  const dom = parseComponentSource(htmlContent);
  const bodyChildren = Array.from(dom.window.document.body.children);
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

  if (usesBlocks) {
    componentSnippets.unshift(BLOCK_RUNTIME);
  }
  if (requiresRuntime) {
    componentSnippets.unshift(ensureRuntime());
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

  const joinedCode = componentSnippets.join('\n\n');
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
  element: Element,
  options: ParseOptions
): ComponentCompileInternalResult {
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];

  const metadata = readComponentMetadata(element, errors, warnings);
  addNodeLocations(errors, element);
  addNodeLocations(warnings, element);
  if (!metadata) {
    return { codeSnippets: [], errors, warnings, requiresRuntime: false };
  }

  const renderTargetVar = 'componentRoot';
  const componentFields = collectComponentFields(element, metadata);
  const {
    ir: renderIR,
    errors: renderErrors,
    warnings: renderWarnings,
  } = elementsToComponentCode(
    element,
    renderTargetVar,
    options,
    componentFields
  );

  errors.push(...renderErrors);
  warnings.push(...renderWarnings);

  const inputNames = new Set(metadata.inputs.map((input) => input.propName));
  for (const stateName of collectInitialStateRoots(renderIR)) {
    if (
      isReservedComponentProperty(stateName) ||
      isNativeElementProperty(element, stateName)
    ) {
      errors.push({
        type: 'validation',
        message: `Component state "${stateName}" conflicts with the custom element runtime`,
        tag: 'COMPONENT',
      });
      continue;
    }
    if (inputNames.has(stateName)) {
      errors.push({
        type: 'validation',
        message: `Component field "${stateName}" cannot be both a prop and local state`,
        tag: 'COMPONENT',
      });
    }
  }

  const stateRoots = new Set(collectInitialStateRoots(renderIR));
  const methodNames = new Set<string>();
  for (const method of collectMethods(renderIR)) {
    if (
      isReservedComponentProperty(method.name) ||
      isNativeElementProperty(element, method.name)
    ) {
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
    renderTargetVar,
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
    requiresRuntime: containsRuntimeDependency(renderIR),
    usesBlocks,
    artifact: {
      name: metadata.tagName,
      className: metadata.className,
      tagName: metadata.tagName,
      shadowMode: metadata.shadowMode,
      inputs: metadata.inputs.map((input) => ({ ...input })),
      events: collectEmittedEventNames(renderIR).map((name) => ({
        name,
      })),
      methods: collectMethods(renderIR).map((method) => ({
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
  element: Element,
  metadata: ComponentMetadata
): Set<string> {
  const fields = new Set<string>(BUILTIN_COMPONENT_FIELDS);
  for (const input of metadata.inputs) {
    fields.add(input.propName);
  }
  for (const [tagName, attribute] of FIELD_DECLARATIONS) {
    for (const declaration of Array.from(
      element.getElementsByTagName(tagName)
    )) {
      const value = declaration.getAttribute(attribute);
      const match = value ? IDENTIFIER_ROOT.exec(value.trim()) : null;
      if (match && match[1] !== 'this') {
        fields.add(match[1]);
      }
    }
  }
  for (const candidate of Array.from(element.getElementsByTagName('*'))) {
    for (const attr of Array.from(candidate.attributes)) {
      if (attr.name.startsWith('bind:')) {
        const match = IDENTIFIER_ROOT.exec(attr.value.trim());
        if (match && match[1] !== 'this') {
          fields.add(match[1]);
        }
      }
    }
  }
  return fields;
}

function readComponentMetadata(
  element: Element,
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

  const props = parseComponentProps(
    element.getAttribute('props'),
    element,
    errors
  );
  const explicitObservedAttributes = parseAttributeList(
    element.getAttribute('observed'),
    errors
  );
  const inputs = resolveComponentInputs(
    props,
    explicitObservedAttributes,
    element,
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
  element: Element,
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

    if (
      isReservedComponentProperty(propName) ||
      isNativeElementProperty(element, propName)
    ) {
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
  element: Element,
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

    if (
      isReservedComponentProperty(propName) ||
      isNativeElementProperty(element, propName)
    ) {
      errors.push({
        type: 'validation',
        message: `Observed attribute "${attributeName}" maps to reserved property "${propName}"`,
        tag: 'COMPONENT',
      });
      continue;
    }

    if (!inputs.has(propName)) {
      inputs.set(propName, {
        propName,
        attributeName,
        type: 'string',
      });
      continue;
    }

    const existing = inputs.get(propName);
    if (existing) {
      existing.attributeName = attributeName;
    }
  }

  return Array.from(inputs.values());
}

function buildComponentClass(
  metadata: ComponentMetadata,
  renderIR: ComponentIR,
  renderTargetVar: string,
  componentFields: ReadonlySet<string> = new Set(),
  blockDocument: Document | null = null
): { code: string; usesBlocks: boolean } {
  const observedGetter =
    metadata.observedAttributes.length > 0
      ? `  static get observedAttributes() { return ${JSON.stringify(metadata.observedAttributes)}; }`
      : '';

  const inputInitialization =
    metadata.inputs.length > 0
      ? metadata.inputs
          .map(
            (input) =>
              `    this.__htmsDefineInputProperty(${JSON.stringify(input.propName)}, ${JSON.stringify(input.attributeName)}, ${JSON.stringify(input.type)});`
          )
          .join('\n')
      : '';

  const inputMap =
    metadata.inputs.length > 0
      ? Object.fromEntries(
          metadata.inputs.map((input) => [
            input.attributeName,
            { propName: input.propName, type: input.type },
          ])
        )
      : {};

  const shadowInit =
    metadata.shadowMode === 'none' ? `    this.__htmsRoot = this;` : '';

  const renderRootHelper =
    metadata.shadowMode === 'none'
      ? ''
      : `  __htmsEnsureRenderRoot() {
    if (this.__htmsRoot) {
      return this.__htmsRoot;
    }

    const declarativeTemplate = Array.from(this.children).find(child =>
      child.localName === 'template' && child.hasAttribute('shadowrootmode')
    );
    const existingRoot = this.shadowRoot;
    const root = existingRoot || this.attachShadow({ mode: '${metadata.shadowMode}' });
    if (declarativeTemplate) {
      root.appendChild(declarativeTemplate.content);
      declarativeTemplate.remove();
    }
    this.__htmsRoot = root;
    return root;
  }

`;

  const attributeChanged =
    metadata.observedAttributes.length > 0
      ? `  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) {
      return;
    }
    const reflected = this.__htmsSetInputFromAttribute(name, newValue);
    if (!reflected && this.__htmsConnected) {
      this.requestUpdate();
    }
  }`
      : '';

  const lifecycleExtras = [observedGetter, attributeChanged].filter(
    (section) => section.length > 0
  );
  const lifecycleSection =
    lifecycleExtras.length > 0 ? `\n\n${lifecycleExtras.join('\n\n')}\n` : '\n';

  const templateHTML = templateNodesToHTML(renderIR.templateNodes);
  const componentInterpolationVars = Array.from(
    new Set([
      ...metadata.inputs.map((input) => input.propName),
      ...collectStateRoots(renderIR),
      ...collectMethods(renderIR).map((method) => method.name),
      ...componentFields,
    ])
  );
  const inputNames = new Set(metadata.inputs.map((input) => input.propName));
  const reactiveStateRoots = collectInitialStateRoots(renderIR).filter(
    (name) => !inputNames.has(name)
  );
  const hasDynamicTemplateValues = templateNodesHaveInterpolations(
    renderIR.templateNodes,
    [],
    componentInterpolationVars
  );
  const hasStaticTemplate =
    templateHTML.trim().length > 0 &&
    !hasDynamicTemplateValues &&
    !templateNodesHaveDirectives(renderIR.templateNodes);
  const hasEventDirectives = containsEvent(renderIR);
  const hasStateDirectives = containsState(renderIR);
  const preservesFocus =
    metadata.inputs.length > 0 ||
    hasStateDirectives ||
    containsBindings(renderIR);
  const controlledSelectors = collectControlledSelectors(renderIR);
  const directiveCounter = { value: 0 };

  let blockPlan: BlockComponentPlan | null = null;
  if (blockDocument) {
    try {
      blockPlan = compileBlockComponent(renderIR, {
        className: metadata.className,
        document: blockDocument,
        componentFields: componentInterpolationVars,
        renderEventBody: (directive, eventRootVar, scopeVars) =>
          renderEventBody(
            directive,
            eventRootVar,
            directiveCounter,
            scopeVars,
            componentInterpolationVars
          ),
      });
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
  const renderDirectiveChild = (
    directive: DirectiveNode,
    targetVar: string
  ): string[] =>
    renderDirective(
      directive,
      targetVar,
      directiveCounter,
      '',
      [],
      componentInterpolationVars
    );
  const templateStatements = hasStaticTemplate
    ? ''
    : serializeTemplateNodes(
        renderIR.templateNodes,
        renderTargetVar,
        [],
        componentInterpolationVars,
        renderDirectiveChild,
        directiveCounter
      );

  const renderLines: string[] = [
    `    const root = this.__htmsRoot || this;`,
    `    if (!root) {`,
    `      throw new Error('Component root not initialized');`,
    `    }`,
    `    const ${renderTargetVar} = document.createDocumentFragment();`,
  ];

  if (preservesFocus) {
    renderLines.push(
      `    const __htmsFocusSnapshot = this.__htmsSnapshotFocus(root, ${JSON.stringify(controlledSelectors)});`
    );
  }

  if (hasEventDirectives) {
    renderLines.push(`    this.__htmsCleanupRenderListeners();`);
  }

  const lifecycleState = collectLifecycleStateDirectives(renderIR);
  for (const directive of lifecycleState.init) {
    renderLines.push(...renderStateDirective(directive, '    '));
  }
  for (const directive of lifecycleState.derive) {
    renderLines.push(...renderStateDirective(directive, '    '));
  }

  if (hasStaticTemplate) {
    renderLines.push(
      `    const staticFragment = ${metadata.className}.__htmsTemplate.content.cloneNode(true);`
    );
    renderLines.push(`    ${renderTargetVar}.appendChild(staticFragment);`);
  } else if (templateStatements.trim().length > 0) {
    for (const line of templateStatements.split('\n')) {
      if (line.trim().length === 0) continue;
      renderLines.push(`    ${line}`);
    }
  }

  for (const directive of renderIR.directives) {
    if (
      directive.kind === 'state' &&
      (directive.mode === 'init' || directive.mode === 'derive')
    ) {
      continue;
    }
    const directiveLines = renderDirective(
      directive,
      renderTargetVar,
      directiveCounter,
      '    ',
      [],
      componentInterpolationVars
    );
    renderLines.push(...directiveLines);
  }

  renderLines.push(
    `    this.__htmsReconcileChildren(root, ${renderTargetVar});`
  );

  if (preservesFocus) {
    renderLines.push(`    this.__htmsRestoreFocus(root, __htmsFocusSnapshot);`);
  }

  const staticTemplateProperty = hasStaticTemplate
    ? `  static get __htmsTemplate() {\n    if (!this.__templateCache) {\n      const template = document.createElement('template');\n      template.innerHTML = ${JSON.stringify(templateHTML)};\n      this.__templateCache = template;\n    }\n    return this.__templateCache;\n  }\n\n`
    : '';

  const inputHelpers =
    metadata.inputs.length > 0
      ? `  static get __htmsInputMap() {
    return ${JSON.stringify(inputMap)};
  }

  __htmsDeserializeAttribute(type, value) {
    if (type === 'boolean') {
      return value !== null;
    }
    if (value === null) {
      return null;
    }
    if (type === 'number') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    }
    return value;
  }

  __htmsDefineInputProperty(propName, attributeName, type) {
    const hadOwnValue = Object.prototype.hasOwnProperty.call(this, propName);
    const ownValue = hadOwnValue ? this[propName] : undefined;
    if (hadOwnValue) {
      delete this[propName];
    }

    Object.defineProperty(this, propName, {
      configurable: true,
      enumerable: true,
      get: () => this.__htmsProps[propName],
      set: value => {
        const previous = this.__htmsProps[propName];
        if (Object.is(previous, value)) {
          return;
        }
        this.__htmsProps[propName] = value;
        this.__htmsRequestRender();
      }
    });

    if (hadOwnValue) {
      this.__htmsProps[propName] = ownValue;
      return;
    }

    if (this.hasAttribute(attributeName)) {
      this.__htmsProps[propName] = this.__htmsDeserializeAttribute(
        type,
        this.getAttribute(attributeName)
      );
      return;
    }

    this.__htmsProps[propName] = type === 'boolean' ? false : null;
  }

  __htmsSetInputFromAttribute(name, value) {
    const input = this.constructor.__htmsInputMap[name];
    if (!input) {
      return false;
    }
    this[input.propName] = this.__htmsDeserializeAttribute(input.type, value);
    return true;
  }

`
      : '';

  const stateHelpers = hasStateDirectives
    ? `  __htmsDefineStateProperty(propName) {
    const hadOwnValue = Object.prototype.hasOwnProperty.call(this, propName);
    const ownValue = hadOwnValue ? this[propName] : undefined;
    if (hadOwnValue) {
      delete this[propName];
    }

    Object.defineProperty(this, propName, {
      configurable: true,
      enumerable: true,
      get: () => this.__htmsState[propName],
      set: value => {
        const previous = this.__htmsState[propName];
        if (Object.is(previous, value)) {
          return;
        }
        this.__htmsState[propName] = value;
        if (!this.__htmsRendering) {
          this.__htmsRequestRender();
        }
      }
    });

    if (hadOwnValue) {
      this.__htmsState[propName] = ownValue;
    }
  }

  __htmsAdoptState(propName) {
    // A value assigned before the element upgraded is an own property that
    // would hide the class accessor; move it into state.
    if (Object.prototype.hasOwnProperty.call(this, propName)) {
      const value = this[propName];
      delete this[propName];
      this.__htmsState[propName] = value;
    }
  }

  __htmsNotifyStateChange() {
    if (!this.__htmsRendering) {
      this.__htmsRequestRender();
    }
  }

  __htmsResolvePath(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('Invalid state path');
    }
    let ref = this;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      const next = ref[key];
      if (next === undefined || next === null || typeof next !== 'object') {
        ref[key] = {};
      }
      ref = ref[key];
    }
    return { target: ref, key: path[path.length - 1] };
  }

  __htmsInitState(path, initializer) {
    const { target, key } = this.__htmsResolvePath(path);
    const storage = target === this ? this.__htmsState : target;
    if (!Object.prototype.hasOwnProperty.call(storage, key)) {
      target[key] = initializer();
    }
  }

  __htmsSetState(path, op, valueFactory) {
    const { target, key } = this.__htmsResolvePath(path);
    if (op === '++') {
      const current = typeof target[key] === 'number' ? target[key] : 0;
      target[key] = current + 1;
      this.__htmsNotifyStateChange();
      return;
    }
    if (op === '--') {
      const current = typeof target[key] === 'number' ? target[key] : 0;
      target[key] = current - 1;
      this.__htmsNotifyStateChange();
      return;
    }
    const current = target[key];
    const value = valueFactory();
    switch (op) {
      case '+=':
        if (current == null) {
          target[key] = typeof value === 'string' ? value : 0 + value;
        } else {
          target[key] = current + value;
        }
        break;
      case '-=':
        target[key] = (typeof current === 'number' ? current : 0) - value;
        break;
      case '*=':
        target[key] = (typeof current === 'number' ? current : 0) * value;
        break;
      case '/=':
        target[key] = (typeof current === 'number' ? current : 0) / value;
        break;
      default:
        target[key] = value;
    }
    this.__htmsNotifyStateChange();
  }

  __htmsEnsureArray(path) {
    const { target, key } = this.__htmsResolvePath(path);
    if (!Array.isArray(target[key])) {
      target[key] = [];
    }
    return target[key];
  }

  __htmsPushState(path, valueFactory) {
    const arr = this.__htmsEnsureArray(path);
    arr.push(valueFactory());
    this.__htmsNotifyStateChange();
  }

  __htmsSpliceState(path, indexFactory, deleteFactory, valuesFactory) {
    const arr = this.__htmsEnsureArray(path);
    const index = indexFactory();
    const del = deleteFactory();
    const values = valuesFactory();
    arr.splice(index, del, ...values);
    this.__htmsNotifyStateChange();
  }

`
    : '';

  const updateHelpers = `  get updateComplete() {
    return this.__htmsUpdatePromise;
  }

  get renderError() {
    return this.__htmsLastError;
  }

  requestUpdate() {
    return this.__htmsRequestRender();
  }

  $(selector) {
    return (this.__htmsRoot || this).querySelector(selector);
  }

  $$(selector) {
    return Array.from((this.__htmsRoot || this).querySelectorAll(selector));
  }

  emit(name, detail, options) {
    return this.dispatchEvent(new CustomEvent(name, Object.assign({
      detail,
      bubbles: true,
      composed: true,
      cancelable: false
    }, options)));
  }

  __htmsAfterMethod() {
    // Methods may mutate nested state; re-render afterwards unless the
    // method was called while rendering (e.g. from an interpolation).
    if (!this.__htmsRendering) {
      this.__htmsRequestRender();
    }
  }

  __htmsSafeUrl(value) {
    const text = value == null ? '' : String(value);
    const normalized = text.replace(/[\\u0000-\\u0020]/g, '').toLowerCase();
    if (
      normalized.startsWith('javascript:') ||
      normalized.startsWith('vbscript:') ||
      normalized.startsWith('data:text/html')
    ) {
      console.warn('HTMS blocked an unsafe URL:', text);
      return 'about:blank';
    }
    return text;
  }

  __htmsToText(value) {
    return value == null ? '' : String(value);
  }

  __htmsRequestRender() {
    if (!this.__htmsConnected || this.__htmsRenderScheduled) {
      return this.__htmsUpdatePromise;
    }

    this.__htmsRenderScheduled = true;
    this.__htmsUpdatePromise = new Promise(resolve => {
      this.__htmsResolveUpdate = resolve;
    });

    queueMicrotask(() => {
      if (!this.__htmsRenderScheduled) {
        return;
      }
      this.__htmsRenderScheduled = false;
      if (this.__htmsConnected) {
        this.render();
      } else {
        this.__htmsFinishUpdate();
      }
    });

    return this.__htmsUpdatePromise;
  }

  __htmsFinishUpdate() {
    const resolve = this.__htmsResolveUpdate;
    this.__htmsResolveUpdate = null;
    if (resolve) {
      resolve();
    }
  }

  __htmsReportRenderError(error) {
    this.__htmsLastError = error;
    const errorEvent = new CustomEvent('htms-error', {
      detail: { error, component: this },
      bubbles: true,
      composed: true,
      cancelable: true
    });
    const shouldLog = this.dispatchEvent(errorEvent);
    if (shouldLog) {
      console.error('HTMS component render failed:', error);
    }
  }

`;

  const legacyListenerHelpers = `  __htmsMarkListener(target, eventType, handler, options) {
    if (!target.__htmsListeners) {
      target.__htmsListeners = [];
    }
    target.__htmsListeners.push({ eventType, handler, options });
  }

  __htmsActivateListeners(target, source) {
    const listeners = source.__htmsListeners || [];
    for (const listener of listeners) {
      this.__htmsListen(target, listener.eventType, listener.handler, listener.options);
    }
  }

  __htmsResolveEventRoot(currentTarget, sourceScope) {
    if (sourceScope && sourceScope.__htmsMountedNode) {
      return sourceScope.__htmsMountedNode;
    }
    if (sourceScope && sourceScope.nodeType === Node.ELEMENT_NODE && sourceScope.isConnected) {
      return sourceScope;
    }
    const eventRoot = currentTarget && typeof currentTarget.getRootNode === 'function'
      ? currentTarget.getRootNode()
      : null;
    if (eventRoot && eventRoot !== document) {
      return eventRoot;
    }
    return this.__htmsRoot || this;
  }

`;

  const sharedEventHelpers = `  __htmsListen(target, eventType, handler, options) {
    target.addEventListener(eventType, handler, options);
    this.__htmsRenderCleanups.push(() => {
      target.removeEventListener(eventType, handler, options);
    });
  }

  __htmsClaimOnce(target, id) {
    if (!target) {
      return true;
    }
    if (!target.__htmsOnceFired) {
      target.__htmsOnceFired = new Set();
    }
    if (target.__htmsOnceFired.has(id)) {
      return false;
    }
    target.__htmsOnceFired.add(id);
    return true;
  }

  __htmsDebounce(event, id, delay, callback) {
    const target = event.currentTarget;
    const deferred = this.__htmsDeferEvent(event);
    let timers = this.__htmsTimers.get(target);
    if (!timers) {
      timers = new Map();
      this.__htmsTimers.set(target, timers);
    }
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (timers.size === 0) {
        this.__htmsTimers.delete(target);
      }
      callback(deferred);
    }, delay));
  }

  __htmsDeferEvent(event) {
    // currentTarget is reset to null once dispatch ends; keep the value the
    // handler saw so deferred bodies can still read event.currentTarget.
    const currentTarget = event.currentTarget;
    if (typeof Proxy !== 'function') {
      return event;
    }
    return new Proxy(event, {
      get(target, property) {
        if (property === 'currentTarget') {
          return currentTarget;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  __htmsClearTimers() {
    for (const timers of this.__htmsTimers.values()) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }
    this.__htmsTimers.clear();
  }

  __htmsCleanupRenderListeners() {
    const cleanups = this.__htmsRenderCleanups;
    this.__htmsRenderCleanups = [];
    for (const cleanup of cleanups) {
      cleanup();
    }
  }

`;

  const eventHelpers = hasEventDirectives
    ? `${legacyListenerHelpers}${sharedEventHelpers}`
    : '';

  const reconciliationHelpers = `  __htmsMarkProperty(target, path, value) {
    if (!target.__htmsProperties) {
      target.__htmsProperties = [];
    }
    target.__htmsProperties.push({ path, value });
  }

  __htmsApplyProperties(target, source) {
    const properties = source.__htmsProperties || [];
    for (const property of properties) {
      let receiver = target;
      for (const segment of property.path.slice(0, -1)) {
        if (receiver[segment] == null) {
          receiver[segment] = {};
        }
        receiver = receiver[segment];
      }
      receiver[property.path[property.path.length - 1]] = property.value;
    }
  }

  __htmsNodesMatch(target, source) {
    if (
      !target ||
      target.nodeType !== source.nodeType ||
      target.nodeName !== source.nodeName ||
      target.namespaceURI !== source.namespaceURI
    ) {
      return false;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }
    const sourceKey = source.getAttribute('data-key');
    const targetKey = target.getAttribute('data-key');
    return sourceKey === null && targetKey === null
      ? true
      : sourceKey === targetKey;
  }

  __htmsFindMatchingNode(reference, source, keyedTargets, idTargets) {
    if (source.nodeType === Node.ELEMENT_NODE) {
      const key = source.getAttribute('data-key');
      const id = source.id;
      if (key !== null) {
        const candidate = keyedTargets.get(key);
        if (this.__htmsNodesMatch(candidate, source)) {
          keyedTargets.delete(key);
          return candidate;
        }
      } else if (id) {
        const candidate = idTargets.get(id);
        if (this.__htmsNodesMatch(candidate, source)) {
          idTargets.delete(id);
          return candidate;
        }
      }
    }
    return this.__htmsNodesMatch(reference, source) ? reference : null;
  }

  __htmsAttributeSnapshot(node) {
    const snapshot = Object.create(null);
    for (const attr of Array.from(node.attributes)) {
      snapshot[attr.name] = attr.value;
    }
    return snapshot;
  }

  __htmsRecordAttributes(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    node.__htmsAttrs = this.__htmsAttributeSnapshot(node);
    Array.from(node.querySelectorAll('*')).forEach(child => {
      child.__htmsAttrs = this.__htmsAttributeSnapshot(child);
    });
  }

  __htmsSyncAttributes(target, source) {
    const next = this.__htmsAttributeSnapshot(source);
    const previous = target.__htmsAttrs;
    if (!previous) {
      // First sync of an adopted node (server-rendered markup): match the
      // rendered output exactly.
      Array.from(target.attributes).forEach(attr => {
        if (!(attr.name in next)) {
          target.removeAttribute(attr.name);
        }
      });
      for (const name in next) {
        if (target.getAttribute(name) !== next[name]) {
          target.setAttribute(name, next[name]);
        }
      }
    } else {
      // Only touch attributes whose rendered value changed. Attributes the
      // browser or other code changed (an opened <details>, a class added by
      // a library) survive unrelated re-renders.
      for (const name in previous) {
        if (!(name in next)) {
          target.removeAttribute(name);
        }
      }
      for (const name in next) {
        if (previous[name] !== next[name]) {
          target.setAttribute(name, next[name]);
        }
      }
    }
    target.__htmsAttrs = next;
  }

  __htmsActivateTree(node) {
${
  hasEventDirectives
    ? `    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    this.__htmsActivateListeners(node, node);
    Array.from(node.querySelectorAll('*')).forEach(child => {
      this.__htmsActivateListeners(child, child);
    });
`
    : `    return;
`
}  }

  __htmsSyncNode(target, source) {
    source.__htmsMountedNode = target;
    if (
      source.nodeType === Node.TEXT_NODE ||
      source.nodeType === Node.COMMENT_NODE
    ) {
      if (target.nodeValue !== source.nodeValue) {
        target.nodeValue = source.nodeValue;
      }
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    this.__htmsSyncAttributes(target, source);
    this.__htmsApplyProperties(target, source);
${
  hasEventDirectives
    ? `    this.__htmsActivateListeners(target, source);
`
    : ''
}    if (source.localName === 'template' && target.content && source.content) {
      this.__htmsReconcileChildren(target.content, source.content);
      return;
    }
    this.__htmsReconcileChildren(target, source);
  }

  __htmsReconcileChildren(targetParent, sourceParent) {
    const sourceChildren = Array.from(sourceParent.childNodes);
    const keyedTargets = new Map();
    const idTargets = new Map();
    Array.from(targetParent.children || []).forEach(child => {
      const key = child.getAttribute('data-key');
      if (key !== null && !keyedTargets.has(key)) {
        keyedTargets.set(key, child);
      }
      if (child.id && !idTargets.has(child.id)) {
        idTargets.set(child.id, child);
      }
    });
    let reference = targetParent.firstChild;

    for (const source of sourceChildren) {
      const match = this.__htmsFindMatchingNode(
        reference,
        source,
        keyedTargets,
        idTargets
      );
      if (!match) {
        targetParent.insertBefore(source, reference);
        source.__htmsMountedNode = source;
        this.__htmsRecordAttributes(source);
        this.__htmsActivateTree(source);
        reference = source.nextSibling;
        continue;
      }

      if (match !== reference) {
        targetParent.insertBefore(match, reference);
      }
      this.__htmsSyncNode(match, source);
      reference = match.nextSibling;
    }

    while (reference) {
      const next = reference.nextSibling;
      targetParent.removeChild(reference);
      reference = next;
    }
  }

`;

  const focusHelpers = preservesFocus
    ? `  __htmsSnapshotFocus(root, controlledSelectors) {
    const documentActive = typeof document !== 'undefined' ? document.activeElement : null;
    const candidate = root.activeElement || (documentActive && root.contains(documentActive) ? documentActive : null);
    if (!candidate || candidate === root) {
      return null;
    }

    const path = [];
    let current = candidate;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) {
        return null;
      }
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    if (current !== root) {
      return null;
    }

    let controlled = candidate.__htmsControlled === true;
    if (!controlled && typeof candidate.matches === 'function') {
      for (const selector of controlledSelectors) {
        try {
          if (candidate.matches(selector)) {
            controlled = true;
            break;
          }
        } catch (error) {
          console.warn('HTMS ignored invalid controlled selector:', selector, error);
        }
      }
    }

    return {
      path,
      id: candidate.id || null,
      nodeName: candidate.nodeName,
      value: !controlled && 'value' in candidate ? candidate.value : undefined,
      checked: !controlled && 'checked' in candidate ? candidate.checked : undefined,
      selectionStart: typeof candidate.selectionStart === 'number' ? candidate.selectionStart : null,
      selectionEnd: typeof candidate.selectionEnd === 'number' ? candidate.selectionEnd : null,
      selectionDirection: candidate.selectionDirection || 'none',
      scrollTop: candidate.scrollTop,
      scrollLeft: candidate.scrollLeft
    };
  }

  __htmsRestoreFocus(root, snapshot) {
    if (!snapshot) {
      return;
    }

    let candidate = null;
    if (snapshot.id) {
      candidate = Array.from(root.querySelectorAll('[id]')).find(node => node.id === snapshot.id) || null;
    }
    if (!candidate) {
      candidate = root;
      for (const index of snapshot.path) {
        candidate = candidate && candidate.childNodes ? candidate.childNodes[index] : null;
        if (!candidate) {
          return;
        }
      }
    }
    if (!candidate || candidate.nodeName !== snapshot.nodeName || typeof candidate.focus !== 'function') {
      return;
    }

    if (snapshot.value !== undefined && 'value' in candidate) {
      candidate.value = snapshot.value;
    }
    if (snapshot.checked !== undefined && 'checked' in candidate) {
      candidate.checked = snapshot.checked;
    }
    try {
      candidate.focus({ preventScroll: true });
    } catch (error) {
      candidate.focus();
    }
    if (
      snapshot.selectionStart !== null &&
      snapshot.selectionEnd !== null &&
      typeof candidate.setSelectionRange === 'function'
    ) {
      try {
        candidate.setSelectionRange(
          snapshot.selectionStart,
          snapshot.selectionEnd,
          snapshot.selectionDirection
        );
      } catch (error) {
        // Some input types do not expose a selectable text range.
      }
    }
    candidate.scrollTop = snapshot.scrollTop;
    candidate.scrollLeft = snapshot.scrollLeft;
  }

`
    : '';

  const methodsCode = collectMethods(renderIR)
    .map((method) => {
      const bodyLines = method.body.flatMap((directive) =>
        renderDirective(
          directive,
          '(this.__htmsRoot || this)',
          directiveCounter,
          '      ',
          method.params,
          componentInterpolationVars
        )
      );
      return `  ${method.async ? 'async ' : ''}${method.name}(${method.params.join(', ')}) {
    try {
${bodyLines.join('\n')}
    } finally {
      this.__htmsAfterMethod();
    }
  }

`;
    })
    .join('');

  const statePropertyInitialization = reactiveStateRoots
    .map(
      (stateName) =>
        `    this.__htmsDefineStateProperty(${JSON.stringify(stateName)});`
    )
    .join('\n');
  const renderBody = renderLines.map((line) => `  ${line}`).join('\n');

  if (blockPlan) {
    return {
      code: buildBlockComponentClass({
        metadata,
        renderIR,
        plan: blockPlan,
        sections: [
          methodsCode,
          inputHelpers,
          stateHelpers,
          updateHelpers,
          renderRootHelper,
        ],
        sharedEventHelpers,
        lifecycleSection,
        shadowInit,
        statePropertyInitialization,
        inputInitialization,
      }),
      usesBlocks: true,
    };
  }

  return {
    code: finalizeStateStorage(`class ${metadata.className} extends HTMLElement {
${staticTemplateProperty}${methodsCode}${inputHelpers}${stateHelpers}${updateHelpers}${eventHelpers}${reconciliationHelpers}${renderRootHelper}${focusHelpers}  constructor() {
    super();
    this.__htmsRoot = null;
    this.__htmsProps = Object.create(__HTMS_CLASS__.__htmsStore());
    this.__htmsState = Object.create(__HTMS_CLASS__.__htmsStore());
    this.__htmsConnected = false;
    this.__htmsRendering = false;
    this.__htmsRenderScheduled = false;
    this.__htmsResolveUpdate = null;
    this.__htmsUpdatePromise = Promise.resolve();
    this.__htmsLastError = null;
${hasEventDirectives ? `    this.__htmsRenderCleanups = [];\n    this.__htmsTimers = new Map();\n` : ''}
${shadowInit}
${statePropertyInitialization ? `${statePropertyInitialization}\n` : ''}${inputInitialization ? `${inputInitialization}\n` : ''}  }

  connectedCallback() {
${metadata.shadowMode === 'none' ? '' : `    this.__htmsEnsureRenderRoot();\n`}    this.__htmsConnected = true;
    this.render();
  }${lifecycleSection}

  disconnectedCallback() {
    this.__htmsConnected = false;
    this.__htmsRenderScheduled = false;
    this.__htmsFinishUpdate();
${hasEventDirectives ? `    this.__htmsCleanupRenderListeners();\n    this.__htmsClearTimers();\n` : ''}
    if (typeof window !== 'undefined' && window.__htms && typeof window.__htms.disposeEffectsFor === 'function') {
      window.__htms.disposeEffectsFor(this);
    }
  }

  render() {
    this.__htmsRenderScheduled = false;
    this.__htmsRendering = true;
    this.__htmsLastError = null;
    try {
${renderBody}
    } catch (error) {
      this.__htmsReportRenderError(error);
    } finally {
      this.__htmsRendering = false;
      this.__htmsFinishUpdate();
    }
  }
}`),
    usesBlocks: false,
  };
}

interface BlockClassInput {
  metadata: ComponentMetadata;
  renderIR: ComponentIR;
  plan: BlockComponentPlan;
  // Members shared with the reconciling renderer: methods, prop and state
  // accessors, the update API and the shadow root helper.
  sections: string[];
  sharedEventHelpers: string;
  lifecycleSection: string;
  shadowInit: string;
  statePropertyInitialization: string;
  inputInitialization: string;
}

// Drops internal `__htms*` methods nothing reachable calls. Public members
// and lifecycle callbacks are the roots; a helper is kept when a kept member
// mentions it.
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
  for (const match of classCode.matchAll(
    /^ {2}(?:static |get |set |async )*([$\w]+)\(/gm
  )) {
    members.add(match[1]);
  }
  const accessors: string[] = [];
  const code = classCode
    .replace(/__HTMS_CLASS__/g, className)
    .replace(
      /^ {4}this\.__htmsDefineStateProperty\(("[$\w]+")\);$/gm,
      (line, quoted: string) => {
        const name = JSON.parse(quoted) as string;
        if (
          members.has(name) ||
          name === 'constructor' ||
          name === '__proto__'
        ) {
          return line;
        }
        accessors.push(
          `  get ${name}() {\n    return this.__htmsState.${name};\n  }\n\n  set ${name}(value) {\n    if (!Object.is(this.__htmsState.${name}, value)) {\n      this.__htmsState.${name} = value;\n      if (!this.__htmsRendering) this.__htmsRequestRender();\n    }\n  }\n`
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

function pruneUnusedHelpers(classCode: string): string {
  const lines = classCode.split('\n');
  const starts: Array<{ line: number; name: string }> = [];
  lines.forEach((line, index) => {
    const match = /^ {2}(?:static |get |set |async )*([$\w]+)\(/.exec(line);
    if (match) starts.push({ line: index, name: match[1] });
  });
  const chunks = starts.map((start, index) => ({
    name: start.name,
    from: start.line,
    to: index + 1 < starts.length ? starts[index + 1].line : lines.length - 1,
  }));
  const text = (from: number, to: number): string =>
    lines.slice(from, to).join('\n');
  const kept = new Set<number>();
  let reachable = text(0, chunks[0]?.from ?? lines.length);
  chunks.forEach((chunk, index) => {
    if (!chunk.name.startsWith('__htms')) {
      kept.add(index);
      reachable += `\n${text(chunk.from, chunk.to)}`;
    }
  });
  let changed = true;
  while (changed) {
    changed = false;
    chunks.forEach((chunk, index) => {
      if (kept.has(index)) return;
      // eslint-disable-next-line security/detect-non-literal-regexp
      const pattern = new RegExp(`\\b${chunk.name.replace(/\$/g, '\\$')}\\b`);
      if (pattern.test(reachable)) {
        kept.add(index);
        reachable += `\n${text(chunk.from, chunk.to)}`;
        changed = true;
      }
    });
  }
  const removed = new Set<number>();
  chunks.forEach((chunk, index) => {
    if (kept.has(index)) return;
    for (let line = chunk.from; line < chunk.to; line += 1) removed.add(line);
  });
  return lines.filter((_, index) => !removed.has(index)).join('\n');
}

function buildBlockComponentClass(input: BlockClassInput): string {
  const { metadata, renderIR, plan } = input;
  const className = metadata.className;
  const delegated = plan.delegatedEvents;
  const hasListeners = plan.hasHandlers || plan.globalListeners.length > 0;

  const lifecycleState = collectLifecycleStateDirectives(renderIR);
  const renderLines: string[] = [];
  for (const directive of lifecycleState.init) {
    renderLines.push(...renderStateDirective(directive, ''));
  }
  for (const directive of lifecycleState.derive) {
    renderLines.push(...renderStateDirective(directive, ''));
  }
  renderLines.push(
    'if (this.__htmsBlock) {',
    '  this.__htmsU0(this.__htmsBlock);',
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

  const delegatedList = JSON.stringify(delegated);
  const addDelegated =
    delegated.length > 0
      ? `    for (const type of ${delegatedList}) {\n      (this.__htmsRoot || this).addEventListener(type, this.__htmsD);\n      (this.__htmsRoot || this).addEventListener(type, this.__htmsD, true);\n    }\n`
      : '';
  const removeDelegated =
    delegated.length > 0
      ? `    for (const type of ${delegatedList}) {\n      (this.__htmsRoot || this).removeEventListener(type, this.__htmsD);\n      (this.__htmsRoot || this).removeEventListener(type, this.__htmsD, true);\n    }\n`
      : '';

  const sections = input.sections;
  const generated = [plan.members, ...sections, renderBody].join('\n');
  const usesTimers = generated.includes('__htmsDebounce(');
  const usesGlobals = plan.globalListeners.length > 0;

  return pruneUnusedHelpers(
    finalizeStateStorage(`class ${className} extends HTMLElement {
${plan.members}
${sections.join('')}${hasListeners ? input.sharedEventHelpers : ''}${mount}  constructor() {
    super();
    this.__htmsRoot = null;
    this.__htmsProps = Object.create(__HTMS_CLASS__.__htmsStore());
    this.__htmsState = Object.create(__HTMS_CLASS__.__htmsStore());
    this.__htmsConnected = false;
    this.__htmsRendering = false;
    this.__htmsRenderScheduled = false;
    this.__htmsResolveUpdate = null;
    this.__htmsUpdatePromise = Promise.resolve();
    this.__htmsLastError = null;
    this.__htmsBlock = null;
${usesGlobals ? `    this.__htmsRenderCleanups = [];\n    this.__htmsGlobalsBound = false;\n` : ''}${usesTimers ? `    this.__htmsTimers = new Map();\n` : ''}${delegated.length > 0 ? `    this.__htmsD = (event) => __htmsDispatch(this, event);\n` : ''}${input.shadowInit ? `${input.shadowInit}\n` : ''}${input.statePropertyInitialization ? `${input.statePropertyInitialization}\n` : ''}${input.inputInitialization ? `${input.inputInitialization}\n` : ''}  }

  connectedCallback() {
${metadata.shadowMode === 'none' ? '' : `    this.__htmsEnsureRenderRoot();\n`}    this.__htmsConnected = true;
${addDelegated}    this.render();
  }${input.lifecycleSection}
  disconnectedCallback() {
    this.__htmsConnected = false;
    this.__htmsRenderScheduled = false;
    this.__htmsFinishUpdate();
${removeDelegated}${usesGlobals ? `    this.__htmsCleanupRenderListeners();\n    this.__htmsGlobalsBound = false;\n` : ''}${usesTimers ? `    this.__htmsClearTimers();\n` : ''}    if (typeof window !== 'undefined' && window.__htms && typeof window.__htms.disposeEffectsFor === 'function') {
      window.__htms.disposeEffectsFor(this);
    }
  }

  render() {
    this.__htmsRenderScheduled = false;
    this.__htmsRendering = true;
    this.__htmsLastError = null;
    try {
${renderBody}
    } catch (error) {
      this.__htmsReportRenderError(error);
    } finally {
      this.__htmsRendering = false;
      this.__htmsFinishUpdate();
    }
  }
}`)
  );
}

function renderDirective(
  directive: DirectiveNode,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[] = [],
  componentInterpolationVars: string[] = []
): string[] {
  if (directive.kind === 'statement') {
    return directive.code
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => `${indent}${line}`);
  }

  if (directive.kind === 'loop') {
    return renderLoopDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'condition') {
    return renderConditionDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'event') {
    return renderEventDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'visibility') {
    return renderVisibilityDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'switch') {
    return renderSwitchDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'while') {
    return renderWhileDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'class') {
    return renderClassDirective(directive, targetVar, indent);
  }

  if (directive.kind === 'style') {
    return renderStyleDirective(directive, targetVar, indent);
  }

  if (directive.kind === 'attribute') {
    return renderAttributeDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'append') {
    return renderAppendDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'bind') {
    return renderBindDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'keyed-list') {
    return renderKeyedListDirective(
      directive,
      targetVar,
      counter,
      indent,
      scopeVars,
      componentInterpolationVars
    );
  }

  if (directive.kind === 'state') {
    // init/derive directives are hoisted to the top of render() so state
    // is initialized before any template or directive reads it.
    if (directive.mode === 'init' || directive.mode === 'derive') {
      return [];
    }
    return renderStateDirective(directive, indent);
  }

  return [];
}

function renderLoopDirective(
  directive: LoopDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const fragmentVar = `_frag${counter.value++}`;
  const innerIndent = `${indent}  `;
  const loopScopeVars = [...scopeVars];

  if (directive.mode === 'array') {
    const rawSourceVar = `_source${counter.value++}`;
    const arraySourceVar = `_items${counter.value++}`;
    lines.push(`${indent}const ${rawSourceVar} = ${directive.source};`);
    lines.push(
      `${indent}const ${arraySourceVar} = Array.isArray(${rawSourceVar}) ? ${rawSourceVar} : [];`
    );

    loopScopeVars.push(directive.itemVar);
    if (directive.indexVar) {
      loopScopeVars.push(directive.indexVar);
      lines.push(
        `${indent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${arraySourceVar}.length; ${directive.indexVar}++) {`
      );
      lines.push(
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
    lines.push(`${indent}const ${countVar} = ${directive.count};`);
    lines.push(
      `${indent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${countVar}; ${directive.indexVar}++) {`
    );
  }

  lines.push(
    `${innerIndent}const ${fragmentVar} = document.createDocumentFragment();`
  );
  lines.push(
    ...fillFragment(
      fragmentVar,
      directive.template,
      directive.directives,
      counter,
      innerIndent,
      loopScopeVars,
      componentInterpolationVars
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
  lines.push(`${innerIndent}${targetVar}.appendChild(${fragmentVar});`);
  lines.push(`${indent}}`);
  return lines;
}

function renderConditionDirective(
  directive: ConditionDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const trueFragment = `_frag${counter.value++}`;
  const trueIndent = `${indent}  `;

  lines.push(`${indent}if (${directive.condition}) {`);
  lines.push(
    `${trueIndent}const ${trueFragment} = document.createDocumentFragment();`
  );
  lines.push(
    ...fillFragment(
      trueFragment,
      directive.whenTrue.template,
      directive.whenTrue.directives,
      counter,
      trueIndent,
      scopeVars,
      componentInterpolationVars
    )
  );

  lines.push(`${trueIndent}${targetVar}.appendChild(${trueFragment});`);
  lines.push(`${indent}}`);

  if (directive.whenFalse) {
    const falseFragment = `_frag${counter.value++}`;
    lines.push(`${indent}else {`);
    lines.push(
      `${trueIndent}const ${falseFragment} = document.createDocumentFragment();`
    );
    lines.push(
      ...fillFragment(
        falseFragment,
        directive.whenFalse.template,
        directive.whenFalse.directives,
        counter,
        trueIndent,
        scopeVars,
        componentInterpolationVars
      )
    );

    lines.push(`${trueIndent}${targetVar}.appendChild(${falseFragment});`);
    lines.push(`${indent}}`);
  }

  return lines;
}

function renderEventDirective(
  directive: EventDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const handlerVar = `_handler${counter.value++}`;
  const eventRootVar = `_eventRoot${counter.value++}`;
  const timerVar = `_timer${counter.value++}`;
  const innerIndent = `${indent}  `;
  const bodyIndent = `${innerIndent}    `;
  const modifiers = directive.modifiers ?? {};

  // The statements that run when the event fires (or after debounce).
  const bodyLines: string[] = [
    `const ${eventRootVar} = this.__htmsResolveEventRoot(event.currentTarget, ${targetVar});`,
    ...renderEventBody(
      directive,
      eventRootVar,
      counter,
      scopeVars,
      componentInterpolationVars
    ),
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
  lines.push(`${indent}{`);
  lines.push(
    globalTarget
      ? `${innerIndent}const eventTargets = typeof window === 'undefined' ? [] : [${globalTarget}];`
      : `${innerIndent}const eventTargets = ${targetVar}.querySelectorAll(${JSON.stringify(directive.selector)});`
  );
  lines.push(`${innerIndent}eventTargets.forEach(targetEl => {`);
  lines.push(`${bodyIndent}const ${handlerVar} = (event) => {`);
  lines.push(...renderEventPreamble(modifiers, listenerId, `${bodyIndent}  `));
  if (modifiers.debounceMs !== undefined) {
    lines.push(
      `${bodyIndent}  this.__htmsDebounce(event, ${listenerId}, ${modifiers.debounceMs}, (event) => {`
    );
    for (const line of bodyLines) {
      lines.push(`${bodyIndent}    ${line}`);
    }
    lines.push(`${bodyIndent}  });`);
  } else {
    for (const line of bodyLines) {
      lines.push(`${bodyIndent}  ${line}`);
    }
  }
  lines.push(`${bodyIndent}};`);
  // Window, document and host listeners attach directly for this render;
  // element listeners are marked on the fresh node and attached to the
  // live node during reconciliation.
  lines.push(
    globalTarget
      ? `${bodyIndent}this.__htmsListen(targetEl, ${JSON.stringify(directive.eventType)}, ${handlerVar}${listenerOptions});`
      : `${bodyIndent}this.__htmsMarkListener(targetEl, ${JSON.stringify(directive.eventType)}, ${handlerVar}${listenerOptions});`
  );
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

// The statements an <event> directive runs when it fires: its body, then
// its nested directives against `eventRootVar`, then a re-render when any of
// them changed state.
function renderEventBody(
  directive: EventDirective,
  eventRootVar: string,
  counter: { value: number },
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const bodyLines: string[] = [];
  if (directive.body.length > 0) {
    bodyLines.push(...directive.body);
  } else {
    bodyLines.push('// No event body');
  }
  if (directive.directives) {
    for (const nested of directive.directives) {
      bodyLines.push(
        ...renderDirective(
          nested,
          eventRootVar,
          counter,
          '',
          scopeVars,
          componentInterpolationVars
        )
      );
    }
  }
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

// <event target="window"> and friends listen outside the render root.
const GLOBAL_EVENT_TARGETS = new Map([
  ['window', 'window'],
  ['document', 'document'],
  [':host', 'this'],
  ['host', 'this'],
]);

function renderVisibilityDirective(
  directive: VisibilityDirective,
  targetVar: string,
  _counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const condition = directive.condition;
  const selector = JSON.stringify(directive.selector);

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}targets.forEach(node => {`);
  lines.push(
    `${innerIndent}  node.style.display = (${condition}) ? '' : 'none';`
  );
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderAttributeDirective(
  directive: AttributeDirective,
  targetVar: string,
  _counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const selector = JSON.stringify(directive.selector);
  const name = JSON.stringify(directive.name);
  const value = directive.value;

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}targets.forEach(node => {`);
  if (directive.target === 'attribute') {
    lines.push(`${innerIndent}  const attributeValue = ${value};`);
    lines.push(
      `${innerIndent}  if (attributeValue == null || attributeValue === false) { node.removeAttribute(${name}); }`
    );
    const safeValue = URL_ATTRIBUTES.has(directive.name.toLowerCase())
      ? `this.__htmsSafeUrl(attributeValue)`
      : 'String(attributeValue)';
    lines.push(
      `${innerIndent}  else { node.setAttribute(${name}, attributeValue === true ? '' : ${safeValue}); }`
    );
  } else {
    lines.push(
      URL_ATTRIBUTES.has((directive.path?.[0] ?? directive.name).toLowerCase())
        ? `${innerIndent}  const propertyValue = this.__htmsSafeUrl(${value});`
        : `${innerIndent}  const propertyValue = ${value};`
    );
    if (directive.path && directive.path.length > 1) {
      const pathAccess = directive.path
        .map((segment) => `['${segment}']`)
        .join('');
      lines.push(`${innerIndent}  node${pathAccess} = propertyValue;`);
    } else {
      lines.push(`${innerIndent}  node[${name}] = propertyValue;`);
    }
    lines.push(
      `${innerIndent}  this.__htmsMarkProperty(node, ${JSON.stringify(directive.path ?? [directive.name])}, propertyValue);`
    );
  }
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderSwitchDirective(
  directive: SwitchDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const switchVar = `_switch${counter.value++}`;
  const branchIndent = `${indent}  `;

  lines.push(`${indent}const ${switchVar} = ${directive.expression};`);

  directive.cases.forEach((caseBlock, index) => {
    const condition = `${switchVar} === ${caseBlock.value}`;
    lines.push(`${indent}${index === 0 ? 'if' : 'else if'} (${condition}) {`);
    const fragmentVar = `_frag${counter.value++}`;
    lines.push(
      `${branchIndent}const ${fragmentVar} = document.createDocumentFragment();`
    );
    lines.push(
      ...fillFragment(
        fragmentVar,
        caseBlock.template,
        caseBlock.directives,
        counter,
        branchIndent,
        scopeVars,
        componentInterpolationVars
      )
    );
    lines.push(`${branchIndent}${targetVar}.appendChild(${fragmentVar});`);
    lines.push(`${indent}}`);
  });

  if (directive.defaultCase) {
    const fragmentVar = `_frag${counter.value++}`;
    lines.push(`${indent}else {`);
    lines.push(
      `${branchIndent}const ${fragmentVar} = document.createDocumentFragment();`
    );
    lines.push(
      ...fillFragment(
        fragmentVar,
        directive.defaultCase.template,
        directive.defaultCase.directives,
        counter,
        branchIndent,
        scopeVars,
        componentInterpolationVars
      )
    );
    lines.push(`${branchIndent}${targetVar}.appendChild(${fragmentVar});`);
    lines.push(`${indent}}`);
  }

  return lines;
}

function renderWhileDirective(
  directive: WhileDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const guardVar = `_guard${counter.value++}`;
  const fragmentVar = `_frag${counter.value++}`;
  const innerIndent = `${indent}  `;
  const loopIndent = `${innerIndent}  `;

  lines.push(`${indent}{`);
  lines.push(`${innerIndent}let ${guardVar} = 0;`);
  lines.push(`${innerIndent}while (${directive.condition}) {`);
  lines.push(
    `${loopIndent}if (${guardVar}++ >= ${directive.maxIterations}) { console.warn('WHILE exceeded max iterations'); break; }`
  );
  lines.push(
    `${loopIndent}const ${fragmentVar} = document.createDocumentFragment();`
  );
  lines.push(
    ...fillFragment(
      fragmentVar,
      directive.template,
      directive.directives,
      counter,
      loopIndent,
      scopeVars,
      componentInterpolationVars
    )
  );
  lines.push(`${loopIndent}${targetVar}.appendChild(${fragmentVar});`);
  lines.push(`${innerIndent}}`);
  lines.push(`${indent}}`);

  return lines;
}

function renderClassDirective(
  directive: ClassDirective,
  targetVar: string,
  indent: string
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const selector = JSON.stringify(directive.selector);
  const action = directive.action;
  const condition = directive.condition;
  const classList = directive.classNames
    .map((name) => JSON.stringify(name))
    .join(', ');

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}targets.forEach(node => {`);
  lines.push(`${innerIndent}  const classes = [${classList}];`);
  lines.push(`${innerIndent}  classes.forEach(cls => {`);
  if (condition) {
    lines.push(
      `${innerIndent}    node.classList.toggle(cls, !!(${condition}));`
    );
  } else if (action === 'add') {
    lines.push(`${innerIndent}    node.classList.add(cls);`);
  } else if (action === 'remove') {
    lines.push(`${innerIndent}    node.classList.remove(cls);`);
  } else {
    lines.push(`${innerIndent}    node.classList.toggle(cls);`);
  }
  lines.push(`${innerIndent}  });`);
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderStyleDirective(
  directive: StyleDirective,
  targetVar: string,
  indent: string
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const selector = JSON.stringify(directive.selector);
  const prop = JSON.stringify(directive.property);
  const value = directive.value;

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}targets.forEach(node => {`);
  if (directive.mode === 'css') {
    lines.push(`${innerIndent}  node.style.setProperty(${prop}, ${value});`);
  } else {
    lines.push(`${innerIndent}  node.style[${prop}] = ${value};`);
  }
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function fillFragment(
  fragmentVar: string,
  template: TemplateNode[],
  directives: DirectiveNode[] | undefined,
  counter: { value: number },
  indent: string,
  scopeVars: string[] = [],
  componentInterpolationVars: string[] = []
): string[] {
  const lines: string[] = [];
  const serialized = serializeTemplateNodes(
    template,
    fragmentVar,
    scopeVars,
    componentInterpolationVars,
    (nested, target) =>
      renderDirective(
        nested,
        target,
        counter,
        '',
        scopeVars,
        componentInterpolationVars
      ),
    counter
  );

  if (serialized.trim().length > 0) {
    for (const line of serialized.split('\n')) {
      if (line.trim().length === 0) {
        continue;
      }
      lines.push(`${indent}${line}`);
    }
  }

  if (directives) {
    for (const nested of directives) {
      lines.push(
        ...renderDirective(
          nested,
          fragmentVar,
          counter,
          indent,
          scopeVars,
          componentInterpolationVars
        )
      );
    }
  }

  return lines;
}

function renderAppendDirective(
  directive: AppendDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const selector = JSON.stringify(directive.selector);
  const fragmentVar = `_frag${counter.value++}`;

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}targets.forEach(node => {`);
  lines.push(
    `${innerIndent}  const ${fragmentVar} = document.createDocumentFragment();`
  );
  lines.push(
    ...fillFragment(
      fragmentVar,
      directive.template,
      directive.directives,
      counter,
      `${innerIndent}  `,
      scopeVars,
      componentInterpolationVars
    )
  );
  lines.push(`${innerIndent}  node.appendChild(${fragmentVar});`);
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderBindDirective(
  directive: BindDirective,
  targetVar: string,
  _counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const selector = JSON.stringify(directive.selector);
  const property = JSON.stringify(directive.property);
  const expression = directive.expression;

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const nodes = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}nodes.forEach(node => {`);
  lines.push(`${innerIndent}  try {`);
  lines.push(
    `${innerIndent}    const value = (function() { return ${expression}; }).call(this);`
  );
  lines.push(`${innerIndent}    node[${property}] = value;`);
  lines.push(
    `${innerIndent}    this.__htmsMarkProperty(node, [${property}], value);`
  );
  lines.push(`${innerIndent}  } catch (error) {`);
  lines.push(
    `${innerIndent}    console.error(${JSON.stringify(`BIND evaluation failed for ${directive.selector}`)}, error);`
  );
  lines.push(`${innerIndent}  }`);
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderKeyedListDirective(
  directive: KeyedListDirective,
  targetVar: string,
  counter: { value: number },
  indent: string,
  scopeVars: string[],
  componentInterpolationVars: string[]
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const bodyIndent = `${innerIndent}  `;
  const loopIndent = `${bodyIndent}  `;
  const selector = JSON.stringify(directive.selector);
  const targetsVar = `_targets${counter.value++}`;
  const rawSourceVar = `_source${counter.value++}`;
  const arraySourceVar = `_items${counter.value++}`;
  const fragmentVar = `_frag${counter.value++}`;
  const keyVar = `_key${counter.value++}`;
  const keyTextVar = `_keyText${counter.value++}`;
  const keyedNodeVar = `_keyedNode${counter.value++}`;
  const loopScopeVars = [...scopeVars, directive.itemVar, directive.indexVar];

  lines.push(`${indent}{`);
  lines.push(
    `${innerIndent}const ${targetsVar} = ${targetVar}.querySelectorAll(${selector});`
  );
  lines.push(`${innerIndent}${targetsVar}.forEach(container => {`);
  lines.push(`${bodyIndent}const ${rawSourceVar} = ${directive.source};`);
  lines.push(
    `${bodyIndent}const ${arraySourceVar} = Array.isArray(${rawSourceVar}) ? ${rawSourceVar} : [];`
  );
  lines.push(
    `${bodyIndent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${arraySourceVar}.length; ${directive.indexVar}++) {`
  );
  lines.push(
    `${loopIndent}const ${directive.itemVar} = ${arraySourceVar}[${directive.indexVar}];`
  );
  lines.push(
    `${loopIndent}const ${fragmentVar} = document.createDocumentFragment();`
  );
  lines.push(
    ...fillFragment(
      fragmentVar,
      directive.template,
      undefined,
      counter,
      loopIndent,
      loopScopeVars,
      componentInterpolationVars
    )
  );
  lines.push(`${loopIndent}const ${keyVar} = ${directive.key};`);
  lines.push(`${loopIndent}const ${keyTextVar} = String(${keyVar});`);
  lines.push(
    `${loopIndent}const ${keyedNodeVar} = ${fragmentVar}.firstElementChild;`
  );
  lines.push(
    `${loopIndent}if (${keyedNodeVar} && typeof ${keyedNodeVar}.setAttribute === 'function') {`
  );
  lines.push(
    `${loopIndent}  ${keyedNodeVar}.setAttribute('data-key', ${keyTextVar});`
  );
  lines.push(`${loopIndent}}`);
  lines.push(`${loopIndent}if (${keyedNodeVar}) {`);
  lines.push(`${loopIndent}  container.appendChild(${keyedNodeVar});`);
  if (directive.directives && directive.directives.length > 0) {
    for (const nested of directive.directives) {
      lines.push(
        ...renderDirective(
          nested,
          keyedNodeVar,
          counter,
          `${loopIndent}  `,
          loopScopeVars,
          componentInterpolationVars
        )
      );
    }
  }
  lines.push(`${loopIndent}} else {`);
  lines.push(`${loopIndent}  container.appendChild(${fragmentVar});`);
  lines.push(`${loopIndent}}`);
  lines.push(`${bodyIndent}}`);
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderStateDirective(
  directive: StateDirective,
  indent: string
): string[] {
  const lines: string[] = [];
  const pathLiteral = JSON.stringify(directive.path);

  switch (directive.mode) {
    case 'init':
      lines.push(
        `${indent}this.__htmsInitState(${pathLiteral}, () => (${directive.value ?? 'undefined'}));`
      );
      break;
    case 'derive':
      lines.push(`${indent}{`);
      lines.push(
        `${indent}  const resolved = this.__htmsResolvePath(${pathLiteral});`
      );
      lines.push(
        `${indent}  resolved.target[resolved.key] = (${directive.value ?? 'undefined'});`
      );
      lines.push(`${indent}}`);
      break;
    case 'set':
      lines.push(
        `${indent}this.__htmsSetState(${pathLiteral}, '${directive.op ?? '='}', () => (${directive.op === '++' || directive.op === '--' ? 'undefined' : (directive.value ?? 'undefined')}));`
      );
      break;
    case 'push':
      lines.push(
        `${indent}this.__htmsPushState(${pathLiteral}, () => (${directive.value ?? 'undefined'}));`
      );
      break;
    case 'splice':
      lines.push(
        `${indent}this.__htmsSpliceState(${pathLiteral}, () => (${directive.index ?? '0'}), () => (${directive.deleteCount ?? '0'}), () => [${(directive.values ?? []).join(', ')}]);`
      );
      break;
  }

  return lines;
}
