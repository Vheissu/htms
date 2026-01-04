import { JSDOM } from 'jsdom';
import { elementsToComponentCode } from './renderer';
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
  SwitchDirective,
  WhileDirective,
  ClassDirective,
  StyleDirective,
  StateDirective,
  TemplateNode
} from './ir';
import { serializeTemplateNodes, templateNodesToHTML } from './template-serializer';
import {
  CompilerError,
  CompilerWarning,
  ParseOptions,
  ComponentCompileResult,
  ComponentArtifact
} from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';

interface ComponentMetadata {
  tagName: string;
  className: string;
  shadowMode: 'open' | 'closed' | 'none';
  props: string[];
  observedAttributes: string[];
}

const SHADOW_MODES = new Set(['open', 'closed', 'none']);

function containsState(directives?: DirectiveNode[]): boolean {
  if (!directives) return false;
  for (const directive of directives) {
    switch (directive.kind) {
      case 'state':
        return true;
      case 'loop':
        if (containsState(directive.directives)) return true;
        break;
      case 'condition':
        if (containsState(directive.whenTrue.directives)) return true;
        if (directive.whenFalse && containsState(directive.whenFalse.directives)) return true;
        break;
      case 'event':
        if (containsState(directive.directives)) return true;
        break;
      case 'visibility':
      case 'attribute':
      case 'bind':
        break;
      case 'append':
        if (containsState(directive.directives)) return true;
        break;
      case 'while':
        if (containsState(directive.directives)) return true;
        break;
      case 'class':
      case 'style':
        break;
      case 'switch':
        if (directive.cases.some(c => containsState(c.directives))) return true;
        if (directive.defaultCase && containsState(directive.defaultCase.directives)) return true;
        break;
    }
  }
  return false;
}

export function compileComponents(htmlContent: string, options: ParseOptions = {}): ComponentCompileResult {
  const dom = new JSDOM(htmlContent);
  const bodyChildren = Array.from(dom.window.document.body.children);
  const componentSnippets: string[] = [];
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];
  const artifacts: ComponentArtifact[] = [];

  if (bodyChildren.length === 0) {
    errors.push({
      type: 'validation',
      message: 'No root elements found. Expected at least one <component> element.'
    });
    return { success: false, errors, warnings, components: [] };
  }

  for (const child of bodyChildren) {
    if (child.tagName.toLowerCase() !== 'component') {
      errors.push({
        type: 'validation',
        message: `Root element <${child.tagName.toLowerCase()}> is not allowed. Wrap markup in a <component> root.`,
        tag: child.tagName
      });
      continue;
    }

    const compileResult = compileComponentElement(child, options);
    componentSnippets.push(...compileResult.codeSnippets);
    if (compileResult.artifact) {
      artifacts.push(compileResult.artifact);
    }
    errors.push(...compileResult.errors);
    warnings.push(...compileResult.warnings);
  }

  if (errors.length > 0 && options.strictMode) {
    return { success: false, errors, warnings, components: [] };
  }

  const joinedCode = componentSnippets.join('\n\n');
  if (!joinedCode.trim()) {
    errors.push({
      type: 'runtime',
      message: 'Component compilation produced no output'
    });
    return { success: false, errors, warnings, components: [] };
  }

  return {
    success: errors.length === 0,
    code: joinedCode,
    components: artifacts,
    errors,
    warnings
  };
}

interface ComponentCompileInternalResult {
  codeSnippets: string[];
  errors: CompilerError[];
  warnings: CompilerWarning[];
  artifact?: ComponentArtifact;
}

function compileComponentElement(element: Element, options: ParseOptions): ComponentCompileInternalResult {
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];

  const metadata = readComponentMetadata(element, errors, warnings);
  if (!metadata) {
    return { codeSnippets: [], errors, warnings };
  }

  const renderTargetVar = 'componentRoot';
  const { ir: renderIR, errors: renderErrors, warnings: renderWarnings } = elementsToComponentCode(
    element,
    renderTargetVar,
    options
  );

  errors.push(...renderErrors);
  warnings.push(...renderWarnings);

  if (options.strictMode && renderErrors.length > 0) {
    return { codeSnippets: [], errors, warnings };
  }

  const classCode = buildComponentClass(metadata, renderIR, renderTargetVar);
  const registrationCode = `customElements.define('${metadata.tagName}', ${metadata.className});`;
  const exportCode = `export { ${metadata.className} };`;

  CompilerLogger.logInfo('Component compiled', {
    component: metadata.tagName,
    className: metadata.className,
    shadowMode: metadata.shadowMode
  });

  return {
    codeSnippets: [classCode, registrationCode, exportCode],
    errors,
    warnings,
    artifact: {
      name: metadata.tagName,
      className: metadata.className,
      tagName: metadata.tagName,
      code: [classCode, registrationCode, exportCode].join('\n\n')
    }
  };
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
      message: '<component> requires a "name" attribute'
    });
    return null;
  }

  const tagName = nameAttr.trim().toLowerCase();
  if (!tagName.includes('-')) {
    errors.push({
      type: 'validation',
      message: `Component name "${tagName}" must include a hyphen`
    });
    return null;
  }

  const nameValidationErrors = SecurityValidator.validateHtmlAttribute('component', tagName);
  if (nameValidationErrors.length > 0) {
    errors.push(...nameValidationErrors);
    return null;
  }

  const className = toClassName(tagName);

  const shadowAttr = (element.getAttribute('shadow') || 'open').toLowerCase();
  if (!SHADOW_MODES.has(shadowAttr)) {
    warnings.push({
      message: `Invalid shadow mode "${shadowAttr}" on component "${tagName}". Defaulting to "open".`,
      tag: 'COMPONENT'
    });
  }
  const shadowMode = SHADOW_MODES.has(shadowAttr) ? (shadowAttr as 'open' | 'closed' | 'none') : 'open';

  const props = parseNameList(element.getAttribute('props'), errors, 'property');
  const observedAttributes = parseAttributeList(element.getAttribute('observed'), errors);

  return {
    tagName,
    className,
    shadowMode,
    props,
    observedAttributes
  };
}

function toClassName(tagName: string): string {
  const segments = tagName.split(/[-_]/).filter(Boolean);
  const pascal = segments.map(segment => segment.charAt(0).toUpperCase() + segment.slice(1)).join('');
  return `${pascal || 'Component'}Component`;
}

function parseNameList(
  value: string | null,
  errors: CompilerError[],
  descriptor: 'property' | 'field'
): string[] {
  if (!value) return [];
  const identifiers: string[] = [];
  for (const raw of value.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const idErrors = SecurityValidator.validateJavaScriptIdentifier(trimmed);
    if (idErrors.length > 0) {
      errors.push(
        ...idErrors.map(error => ({
          ...error,
          message: `${descriptor} "${trimmed}" is invalid: ${error.message}`
        }))
      );
      continue;
    }
    identifiers.push(trimmed);
  }
  return identifiers;
}

function parseAttributeList(value: string | null, errors: CompilerError[]): string[] {
  if (!value) return [];
  const attrs: string[] = [];
  for (const raw of value.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const validationErrors = SecurityValidator.validateHtmlAttribute(trimmed, '');
    if (validationErrors.length > 0) {
      errors.push(
        ...validationErrors.map(error => ({
          ...error,
          message: `Observed attribute "${trimmed}" is invalid: ${error.message}`
        }))
      );
      continue;
    }
    attrs.push(trimmed);
  }
  return attrs;
}

function buildComponentClass(metadata: ComponentMetadata, renderIR: ComponentIR, renderTargetVar: string): string {
  const observedGetter =
    metadata.observedAttributes.length > 0
      ? `  static get observedAttributes() { return ${JSON.stringify(metadata.observedAttributes)}; }`
      : '';

  const propsInitialization =
    metadata.props.length > 0
      ? metadata.props
          .map(
            prop =>
              `    if (!(this as any).hasOwnProperty('${prop}')) {\n      (this as any)['${prop}'] = this.getAttribute('${prop}') ?? null;\n    }`
          )
          .join('\n')
      : '';

  const shadowInit =
    metadata.shadowMode === 'none'
      ? `    this.__htmsRoot = this;`
      : `    if (!this.__htmsRoot) {\n      this.__htmsRoot = this.attachShadow({ mode: '${metadata.shadowMode}' });\n    }`;

  const attributeChanged =
    metadata.observedAttributes.length > 0
      ? `  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) {
      return;
    }
    this.render();
  }`
      : '';

  const lifecycleExtras = [observedGetter, attributeChanged].filter(section => section.length > 0);
  const lifecycleSection = lifecycleExtras.length > 0 ? `\n\n${lifecycleExtras.join('\n\n')}\n` : '\n';

  const templateHTML = templateNodesToHTML(renderIR.templateNodes);
  const hasStaticTemplate = templateHTML.trim().length > 0;
  const templateStatements = hasStaticTemplate ? '' : serializeTemplateNodes(renderIR.templateNodes, renderTargetVar);

  const renderLines: string[] = [
    `    const root = this.__htmsRoot || this;`,
    `    if (!root) {`,
    `      throw new Error('Component root not initialized');`,
    `    }`,
    `    const ${renderTargetVar} = root;`,
    `    while (${renderTargetVar}.firstChild) {`,
    `      ${renderTargetVar}.removeChild(${renderTargetVar}.firstChild);`,
    `    }`
  ];

  if (hasStaticTemplate) {
    renderLines.push(`    const staticFragment = ${metadata.className}.__htmsTemplate.content.cloneNode(true);`);
    renderLines.push(`    ${renderTargetVar}.appendChild(staticFragment);`);
  } else if (templateStatements.trim().length > 0) {
    for (const line of templateStatements.split('\n')) {
      if (line.trim().length === 0) continue;
      renderLines.push(`    ${line}`);
    }
  }

  const directiveCounter = { value: 0 };
  const hasStateDirectives = containsState(renderIR.directives);
  for (const directive of renderIR.directives) {
    const directiveLines = renderDirective(directive, renderTargetVar, directiveCounter, '    ');
    renderLines.push(...directiveLines);
  }

  const staticTemplateProperty = hasStaticTemplate
    ? `  static get __htmsTemplate() {\n    if (!this.__templateCache) {\n      const template = document.createElement('template');\n      template.innerHTML = ${JSON.stringify(templateHTML)};\n      this.__templateCache = template;\n    }\n    return this.__templateCache;\n  }\n\n`
    : '';

  const stateHelpers = hasStateDirectives
    ? `  __htmsResolvePath(path) {\n    if (!Array.isArray(path) || path.length === 0) {\n      throw new Error('Invalid state path');\n    }\n    let ref = this;\n    for (let i = 0; i < path.length - 1; i++) {\n      const key = path[i];\n      const next = ref[key];\n      if (next === undefined || next === null || typeof next !== 'object') {\n        ref[key] = {};\n      }\n      ref = ref[key];\n    }\n    return { target: ref, key: path[path.length - 1] };\n  }\n\n  __htmsInitState(path, initializer) {\n    const { target, key } = this.__htmsResolvePath(path);\n    if (!Object.prototype.hasOwnProperty.call(target, key)) {\n      target[key] = initializer();\n    }\n  }\n\n  __htmsSetState(path, op, valueFactory) {\n    const { target, key } = this.__htmsResolvePath(path);\n    if (op === '++') {\n      const current = typeof target[key] === 'number' ? target[key] : 0;\n      target[key] = current + 1;\n      return;\n    }\n    if (op === '--') {\n      const current = typeof target[key] === 'number' ? target[key] : 0;\n      target[key] = current - 1;\n      return;\n    }\n    const current = target[key];\n    const value = valueFactory();\n    switch (op) {\n      case '+=':\n        target[key] = (typeof current === 'number' ? current : 0) + value;\n        break;\n      case '-=':\n        target[key] = (typeof current === 'number' ? current : 0) - value;\n        break;\n      case '*=':\n        target[key] = (typeof current === 'number' ? current : 0) * value;\n        break;\n      case '/=':\n        target[key] = (typeof current === 'number' ? current : 0) / value;\n        break;\n      default:\n        target[key] = value;\n    }\n  }\n\n  __htmsEnsureArray(path) {\n    const { target, key } = this.__htmsResolvePath(path);\n    if (!Array.isArray(target[key])) {\n      target[key] = [];\n    }\n    return target[key];\n  }\n\n  __htmsPushState(path, valueFactory) {\n    const arr = this.__htmsEnsureArray(path);\n    arr.push(valueFactory());\n  }\n\n  __htmsSpliceState(path, indexFactory, deleteFactory, valuesFactory) {\n    const arr = this.__htmsEnsureArray(path);\n    const index = indexFactory();\n    const del = deleteFactory();\n    const values = valuesFactory();\n    arr.splice(index, del, ...values);\n  }\n\n`
    : '';

  return `class ${metadata.className} extends HTMLElement {
${staticTemplateProperty}${stateHelpers}  constructor() {
    super();
    this.__htmsRoot = null;
${shadowInit}
${propsInitialization ? `${propsInitialization}\n` : ''}  }

  connectedCallback() {
    this.render();
  }${lifecycleSection}

  render() {
${renderLines.join('\n')}
  }
}`;
}

function renderDirective(
  directive: DirectiveNode,
  targetVar: string,
  counter: { value: number },
  indent: string
): string[] {
  if (directive.kind === 'statement') {
    return directive.code
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => `${indent}${line}`);
  }

  if (directive.kind === 'loop') {
    return renderLoopDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'condition') {
    return renderConditionDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'event') {
    return renderEventDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'visibility') {
    return renderVisibilityDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'switch') {
    return renderSwitchDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'while') {
    return renderWhileDirective(directive, targetVar, counter, indent);
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
    return renderAppendDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'bind') {
    return renderBindDirective(directive, targetVar, counter, indent);
  }

  if (directive.kind === 'state') {
    return renderStateDirective(directive, indent);
  }

  return [];
}

function renderLoopDirective(
  directive: LoopDirective,
  targetVar: string,
  counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const fragmentVar = `_frag${counter.value++}`;
  const innerIndent = `${indent}  `;

  if (directive.mode === 'array') {
    if (directive.indexVar) {
      lines.push(
        `${indent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${directive.source}.length; ${directive.indexVar}++) {`
      );
      lines.push(
        `${innerIndent}const ${directive.itemVar} = ${directive.source}[${directive.indexVar}];`
      );
    } else {
      lines.push(`${indent}for (const ${directive.itemVar} of ${directive.source}) {`);
    }
  } else {
    lines.push(
      `${indent}for (let ${directive.indexVar} = 0; ${directive.indexVar} < ${directive.count}; ${directive.indexVar}++) {`
    );
  }

  lines.push(`${innerIndent}const ${fragmentVar} = document.createDocumentFragment();`);
  lines.push(
    ...fillFragment(fragmentVar, directive.template, directive.directives, counter, innerIndent)
  );
  lines.push(`${innerIndent}${targetVar}.appendChild(${fragmentVar});`);
  lines.push(`${indent}}`);
  return lines;
}

function renderConditionDirective(
  directive: ConditionDirective,
  targetVar: string,
  counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const trueFragment = `_frag${counter.value++}`;
  const trueIndent = `${indent}  `;

  lines.push(`${indent}if (${directive.condition}) {`);
  lines.push(`${trueIndent}const ${trueFragment} = document.createDocumentFragment();`);
  lines.push(
    ...fillFragment(trueFragment, directive.whenTrue.template, directive.whenTrue.directives, counter, trueIndent)
  );

  lines.push(`${trueIndent}${targetVar}.appendChild(${trueFragment});`);
  lines.push(`${indent}}`);

  if (directive.whenFalse) {
    const falseFragment = `_frag${counter.value++}`;
    lines.push(`${indent}else {`);
    lines.push(`${trueIndent}const ${falseFragment} = document.createDocumentFragment();`);
    lines.push(
      ...fillFragment(falseFragment, directive.whenFalse.template, directive.whenFalse.directives, counter, trueIndent)
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
  indent: string
): string[] {
  const lines: string[] = [];
  const handlerVar = `_handler${counter.value++}`;
  const innerIndent = `${indent}  `;
  const bodyIndent = `${innerIndent}    `;

  lines.push(`${indent}{`);
  lines.push(`${innerIndent}const eventTargets = ${targetVar}.querySelectorAll(${JSON.stringify(directive.selector)});`);
  lines.push(`${innerIndent}eventTargets.forEach(targetEl => {`);
  lines.push(`${bodyIndent}const ${handlerVar} = (event) => {`);
  if (directive.body.length > 0) {
    for (const line of directive.body) {
      lines.push(`${bodyIndent}  ${line}`);
    }
  } else {
    lines.push(`${bodyIndent}  // No event body`);
  }
  if (directive.directives) {
    for (const nested of directive.directives) {
      lines.push(...renderDirective(nested, targetVar, counter, `${bodyIndent}  `));
    }
  }
  if (directive.directives && containsState(directive.directives)) {
    lines.push(`${bodyIndent}  this.render();`);
  }
  lines.push(`${bodyIndent}};`);
  lines.push(`${bodyIndent}targetEl.addEventListener(${JSON.stringify(directive.eventType)}, ${handlerVar});`);
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

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
  lines.push(`${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`);
  lines.push(`${innerIndent}targets.forEach(node => {`);
  if (directive.mode === 'toggle') {
    lines.push(`${innerIndent}  node.style.display = (${condition}) ? '' : 'none';`);
  } else {
    lines.push(`${innerIndent}  node.style.display = (${condition}) ? '' : 'none';`);
  }
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
  lines.push(`${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`);
  lines.push(`${innerIndent}targets.forEach(node => {`);
  if (directive.target === 'attribute') {
    lines.push(`${innerIndent}  node.setAttribute(${name}, ${value});`);
  } else {
    if (directive.path && directive.path.length > 1) {
      const pathAccess = directive.path
        .map(segment => `['${segment}']`)
        .join('');
      lines.push(`${innerIndent}  node${pathAccess} = ${value};`);
    } else {
      lines.push(`${innerIndent}  node[${name}] = ${value};`);
    }
  }
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderSwitchDirective(
  directive: SwitchDirective,
  targetVar: string,
  counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const switchVar = `_switch${counter.value++}`;
  const branchIndent = `${indent}  `;

  lines.push(`${indent}const ${switchVar} = ${directive.expression};`);

  directive.cases.forEach((caseBlock, index) => {
    const condition = `${switchVar} === ${caseBlock.value}`;
    lines.push(`${indent}${index === 0 ? 'if' : 'else if'} (${condition}) {`);
    const fragmentVar = `_frag${counter.value++}`;
    lines.push(`${branchIndent}const ${fragmentVar} = document.createDocumentFragment();`);
    lines.push(
      ...fillFragment(fragmentVar, caseBlock.template, caseBlock.directives, counter, branchIndent)
    );
    lines.push(`${branchIndent}${targetVar}.appendChild(${fragmentVar});`);
    lines.push(`${indent}}`);
  });

  if (directive.defaultCase) {
    const fragmentVar = `_frag${counter.value++}`;
    lines.push(`${indent}else {`);
    lines.push(`${branchIndent}const ${fragmentVar} = document.createDocumentFragment();`);
    lines.push(
      ...fillFragment(
        fragmentVar,
        directive.defaultCase.template,
        directive.defaultCase.directives,
        counter,
        branchIndent
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
  indent: string
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
  lines.push(`${loopIndent}const ${fragmentVar} = document.createDocumentFragment();`);
  lines.push(
    ...fillFragment(fragmentVar, directive.template, directive.directives, counter, loopIndent)
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
  const classList = directive.classNames.map(name => JSON.stringify(name)).join(', ');

  lines.push(`${indent}{`);
  lines.push(`${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`);
  lines.push(`${innerIndent}targets.forEach(node => {`);
  lines.push(`${innerIndent}  const classes = [${classList}];`);
  lines.push(`${innerIndent}  classes.forEach(cls => {`);
  if (condition) {
    lines.push(`${innerIndent}    node.classList.toggle(cls, !!(${condition}));`);
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
  lines.push(`${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`);
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
  indent: string
): string[] {
  const lines: string[] = [];
  const serialized = serializeTemplateNodes(template, fragmentVar);

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
      lines.push(...renderDirective(nested, fragmentVar, counter, indent));
    }
  }

  return lines;
}

function renderAppendDirective(
  directive: AppendDirective,
  targetVar: string,
  counter: { value: number },
  indent: string
): string[] {
  const lines: string[] = [];
  const innerIndent = `${indent}  `;
  const selector = JSON.stringify(directive.selector);
  const fragmentVar = `_frag${counter.value++}`;

  lines.push(`${indent}{`);
  lines.push(`${innerIndent}const targets = ${targetVar}.querySelectorAll(${selector});`);
  lines.push(`${innerIndent}targets.forEach(node => {`);
  lines.push(`${innerIndent}  const ${fragmentVar} = document.createDocumentFragment();`);
  lines.push(
    ...fillFragment(fragmentVar, directive.template, directive.directives, counter, `${innerIndent}  `)
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
  lines.push(`${innerIndent}const nodes = ${targetVar}.querySelectorAll(${selector});`);
  lines.push(`${innerIndent}nodes.forEach(node => {`);
  lines.push(`${innerIndent}  try {`);
  lines.push(
    `${innerIndent}    const value = (function() { return ${expression}; }).call(this);`
  );
  lines.push(`${innerIndent}    node[${property}] = value;`);
  lines.push(`${innerIndent}  } catch (error) {`);
  lines.push(
    `${innerIndent}    console.error('BIND evaluation failed for ${directive.selector}', error);`
  );
  lines.push(`${innerIndent}  }`);
  lines.push(`${innerIndent}});`);
  lines.push(`${indent}}`);

  return lines;
}

function renderStateDirective(directive: StateDirective, indent: string): string[] {
  const lines: string[] = [];
  const pathLiteral = JSON.stringify(directive.path);

  switch (directive.mode) {
    case 'init':
      lines.push(`${indent}this.__htmsInitState(${pathLiteral}, () => ${directive.value ?? 'undefined'});`);
      break;
    case 'set':
      lines.push(
        `${indent}this.__htmsSetState(${pathLiteral}, '${directive.op ?? '='}', () => ${directive.op === '++' || directive.op === '--' ? 'undefined' : directive.value ?? 'undefined'});`
      );
      break;
    case 'push':
      lines.push(`${indent}this.__htmsPushState(${pathLiteral}, () => ${directive.value ?? 'undefined'});`);
      break;
    case 'splice':
      lines.push(
        `${indent}this.__htmsSpliceState(${pathLiteral}, () => ${directive.index ?? '0'}, () => ${directive.deleteCount ?? '0'}, () => [${(directive.values ?? []).join(', ')}]);`
      );
      break;
  }

  return lines;
}
