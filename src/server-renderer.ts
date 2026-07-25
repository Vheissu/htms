import { JSDOM } from 'jsdom';
import { HydrationManifest } from './hydration';
import { parseHTML } from './parser';
import { ComponentArtifact, CompilerError } from './types';
import { SecurityValidator } from './utils/security';

export interface ServerRenderOptions {
  tagName?: string;
  props?: Record<string, unknown>;
  attributes?: Record<string, string | number | boolean | null>;
  children?: string;
  includeManifestScript?: boolean;
  hydrationId?: string;
  strict?: boolean;
  url?: string;
}

export interface ServerRenderResult {
  html: string;
  componentHtml: string;
  manifest: HydrationManifest;
  artifact: ComponentArtifact;
  code: string;
}

export class ServerRenderError extends Error {
  constructor(
    message: string,
    readonly errors: CompilerError[] = []
  ) {
    super(message);
    this.name = 'ServerRenderError';
  }
}

interface ServerRenderedElement extends HTMLElement {
  __htmsRoot?: HTMLElement | ShadowRoot;
}

interface ServerWindow extends Window {
  __HTMS_SSR__?: boolean;
}

function selectArtifact(
  artifacts: ComponentArtifact[],
  requestedTagName?: string
): ComponentArtifact {
  if (artifacts.length === 0) {
    throw new ServerRenderError('No component was available to render');
  }
  if (!requestedTagName) {
    return artifacts[0];
  }
  const normalizedTagName = requestedTagName.trim().toLowerCase();
  const artifact = artifacts.find(
    (candidate) => candidate.tagName === normalizedTagName
  );
  if (!artifact) {
    throw new ServerRenderError(
      `Component "${normalizedTagName}" was not found in the source`
    );
  }
  return artifact;
}

function applyAttributes(
  element: HTMLElement,
  attributes: ServerRenderOptions['attributes']
): void {
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === false || value === null) {
      continue;
    }
    const attributeValue = value === true ? '' : String(value);
    const errors = SecurityValidator.validateHtmlAttribute(
      name,
      attributeValue
    );
    if (errors.length > 0) {
      throw new ServerRenderError(
        `Invalid server-rendered attribute "${name}": ${errors[0].message}`,
        errors
      );
    }
    element.setAttribute(name, attributeValue);
  }
}

function applyProperties(
  element: HTMLElement,
  artifact: ComponentArtifact,
  props: Record<string, unknown>
): void {
  const declaredInputs = new Set(
    artifact.inputs.map((input) => input.propName)
  );
  for (const [name, value] of Object.entries(props)) {
    if (!declaredInputs.has(name)) {
      throw new ServerRenderError(
        `Unknown property "${name}" for component "${artifact.tagName}"`
      );
    }
    Reflect.set(element, name, value);
  }
}

function serializeComponent(
  element: ServerRenderedElement,
  artifact: ComponentArtifact,
  artifacts: Map<string, ComponentArtifact>
): string {
  if (artifact.shadowMode === 'none') {
    return serializeElement(element, artifacts);
  }

  const root = element.__htmsRoot;
  if (!root) {
    throw new ServerRenderError(
      `Component "${artifact.tagName}" did not create a render root`
    );
  }

  const shallowMarkup = (element.cloneNode(false) as HTMLElement).outerHTML;
  const openingEnd = shallowMarkup.indexOf('>') + 1;
  const openingTag = shallowMarkup.slice(0, openingEnd);
  const closingTag = `</${artifact.tagName}>`;
  const shadowTemplate = `<template shadowrootmode="${artifact.shadowMode}" data-htms-shadow>${serializeChildren(root, artifacts)}</template>`;
  return `${openingTag}${shadowTemplate}${serializeChildren(element, artifacts)}${closingTag}`;
}

function serializeNode(
  node: Node,
  artifacts: Map<string, ComponentArtifact>
): string {
  if (node.nodeType === node.ELEMENT_NODE) {
    return serializeElement(node as ServerRenderedElement, artifacts);
  }
  const template = node.ownerDocument?.createElement('template');
  if (!template) {
    return '';
  }
  template.content.appendChild(node.cloneNode(true));
  return template.innerHTML;
}

function serializeChildren(
  parent: ParentNode,
  artifacts: Map<string, ComponentArtifact>
): string {
  return Array.from(parent.childNodes)
    .map((child) => serializeNode(child, artifacts))
    .join('');
}

function serializeElement(
  element: ServerRenderedElement,
  artifacts: Map<string, ComponentArtifact>
): string {
  const artifact = artifacts.get(element.localName);
  if (artifact && element.__htmsRoot && artifact.shadowMode !== 'none') {
    return serializeComponent(element, artifact, artifacts);
  }

  const shallowMarkup = (element.cloneNode(false) as HTMLElement).outerHTML;
  const closingTag = `</${element.localName}>`;
  if (!shallowMarkup.toLowerCase().endsWith(closingTag.toLowerCase())) {
    return shallowMarkup;
  }
  const openingTag = shallowMarkup.slice(0, -closingTag.length);
  const childRoot =
    element.localName === 'template'
      ? (element as unknown as HTMLTemplateElement).content
      : element;
  return `${openingTag}${serializeChildren(childRoot, artifacts)}${closingTag}`;
}

function cloneSerializableProperties(
  props: Record<string, unknown>
): Record<string, unknown> {
  try {
    const serialized = JSON.stringify(props);
    if (serialized === undefined) {
      throw new Error('properties produced no JSON value');
    }
    const cloned = JSON.parse(serialized) as unknown;
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) {
      throw new Error('properties must serialize to an object');
    }
    return cloned as Record<string, unknown>;
  } catch (error) {
    throw new ServerRenderError(
      `Component properties are not JSON serializable: ${String(error)}`
    );
  }
}

function serializeManifest(manifest: HydrationManifest): string {
  return JSON.stringify(manifest).replace(/</g, '\\u003c');
}

export function renderToString(
  source: string,
  options: ServerRenderOptions = {}
): ServerRenderResult {
  const compilation = parseHTML(source, {
    mode: 'component',
    outputFormat: 'iife',
    strictMode: options.strict ?? true,
  });
  if (!compilation.success || !compilation.code) {
    throw new ServerRenderError(
      'HTMS component compilation failed during server rendering',
      compilation.errors
    );
  }

  const artifact = selectArtifact(
    compilation.components ?? [],
    options.tagName
  );
  const artifacts = new Map(
    (compilation.components ?? []).map((component) => [
      component.tagName,
      component,
    ])
  );
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    url: options.url ?? 'http://localhost/',
  });

  try {
    const serverWindow = dom.window as unknown as ServerWindow;
    serverWindow.__HTMS_SSR__ = true;
    dom.window.eval(compilation.code);

    const element = dom.window.document.createElement(
      artifact.tagName
    ) as ServerRenderedElement;
    applyAttributes(element, options.attributes);
    if (options.children) {
      element.innerHTML = options.children;
    }
    const props = cloneSerializableProperties(options.props ?? {});
    applyProperties(element, artifact, props);
    const hydrationId = options.hydrationId ?? '0';
    if (!/^[a-zA-Z0-9._:-]+$/.test(hydrationId)) {
      throw new ServerRenderError(
        'hydrationId may only contain letters, numbers, dots, underscores, colons, and hyphens'
      );
    }
    element.setAttribute('data-htms-id', hydrationId);
    element.setAttribute('data-htms-ssr', '');
    dom.window.document.body.appendChild(element);

    const manifest: HydrationManifest = {
      version: 1,
      components: [
        {
          id: hydrationId,
          tagName: artifact.tagName,
          shadowMode: artifact.shadowMode,
          props,
        },
      ],
    };
    const serializedManifest = serializeManifest(manifest);
    const componentHtml = serializeComponent(element, artifact, artifacts);
    const manifestScript =
      (options.includeManifestScript ?? true)
        ? `<script type="application/json" data-htms-hydration>${serializedManifest}</script>`
        : '';

    return {
      html: `${componentHtml}${manifestScript}`,
      componentHtml,
      manifest,
      artifact,
      code: compilation.code,
    };
  } finally {
    dom.window.close();
  }
}
