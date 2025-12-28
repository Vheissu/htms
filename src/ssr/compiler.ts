import { JSDOM } from 'jsdom';
import { elementsToComponentCode } from '../component/renderer';
import { ComponentIR } from '../component/ir';
import {
  CompilerError,
  CompilerWarning,
  ParseOptions,
  ComponentCompileResult,
  ComponentArtifact
} from '../types';
import { SecurityValidator } from '../utils/security';
import { CompilerLogger } from '../utils/logger';
import { templateNodesToHTML } from '../component/template-serializer';

interface ComponentMetadata {
  tagName: string;
  className: string;
  props: string[];
  observedAttributes: string[];
}

/**
 * Compiles components with SSR support.
 * Generates both client-side hydration code and server-side rendering utilities.
 */
export function compileComponentsWithSSR(
  htmlContent: string,
  options: ParseOptions = {}
): ComponentCompileResult {
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

    const compileResult = compileComponentElementWithSSR(child, options);
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

function compileComponentElementWithSSR(
  element: Element,
  options: ParseOptions
): ComponentCompileInternalResult {
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

  // Log warnings if any
  if (warnings.length > 0) {
    CompilerLogger.logInfo('Component compilation warnings', { warnings });
  }

  // Generate SSR-enabled component class
  const classCode = buildSSRComponentClass(metadata, renderIR, renderTargetVar);
  const registrationCode = `customElements.define('${metadata.tagName}', ${metadata.className});`;
  const exportCode = `export { ${metadata.className} };`;

  CompilerLogger.logInfo('SSR-enabled component compiled', {
    component: metadata.tagName,
    className: metadata.className
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
  _warnings: CompilerWarning[]
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
  const props = parseNameList(element.getAttribute('props'), errors, 'property');
  const observedAttributes = parseAttributeList(element.getAttribute('observed'), errors);

  return {
    tagName,
    className,
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

function buildSSRComponentClass(
  metadata: ComponentMetadata,
  renderIR: ComponentIR,
  renderTargetVar: string
): string {
  const templateHTML = templateNodesToHTML(renderIR.templateNodes);

  // Generate static renderToString method for SSR
  const ssrRenderMethod = `  static renderToString(props = {}) {
    const template = ${JSON.stringify(templateHTML)};
    // Simple template interpolation for SSR
    let html = template;
    for (const [key, value] of Object.entries(props)) {
      const regex = new RegExp(\`\\\\{\\$\{key\}\\\\}\`, 'g');
      html = html.replace(regex, String(value !== null && value !== undefined ? value : ''));
    }
    return html;
  }`;

  const observedGetter =
    metadata.observedAttributes.length > 0
      ? `  static get observedAttributes() { return ${JSON.stringify(metadata.observedAttributes)}; }`
      : '';

  const propsInitialization =
    metadata.props.length > 0
      ? metadata.props
          .map(
            prop =>
              `    if (!(this as any).hasOwnProperty('${prop}')) {\n      const attrValue = this.getAttribute('${prop}');\n      (this as any)['${prop}'] = attrValue !== null && attrValue !== undefined ? attrValue : null;\n    }`
          )
          .join('\n')
      : '';

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

  return `class ${metadata.className} extends HTMLElement {
  static get __htmsTemplate() {
    if (!this.__templateCache) {
      const template = document.createElement('template');
      template.innerHTML = ${JSON.stringify(templateHTML)};
      this.__templateCache = template;
    }
    return this.__templateCache;
  }

${ssrRenderMethod}

  constructor() {
    super();
    this.__htmsRoot = null;
    if (!this.__htmsRoot) {
      this.__htmsRoot = this.attachShadow({ mode: 'open' });
    }
${propsInitialization ? `${propsInitialization}\n` : ''}  }

  connectedCallback() {
    this.render();
  }${lifecycleSection}

  render() {
    const root = this.__htmsRoot || this;
    if (!root) {
      throw new Error('Component root not initialized');
    }
    const ${renderTargetVar} = root;
    while (${renderTargetVar}.firstChild) {
      ${renderTargetVar}.removeChild(${renderTargetVar}.firstChild);
    }
    const staticFragment = ${metadata.className}.__htmsTemplate.content.cloneNode(true);
    ${renderTargetVar}.appendChild(staticFragment);
  }
}`;
}
