import {
  html,
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  type Token,
  type TreeAdapter,
  type TreeAdapterTypeMap,
} from 'parse5';
import type { Options } from 'css-select';

// css-select (with its domutils dependency) takes ~30ms to load and most
// compiles never run a selector, so it is required on first use.
type CssSelect = typeof import('css-select');
let cssSelect: CssSelect | null = null;
function selectors(): CssSelect {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (cssSelect ??= require('css-select') as CssSelect);
}

// The compiler's view of an HTMS source file: a plain node tree built by
// parse5 (the parser behind jsdom and the browsers' HTML algorithm) with
// the subset of the DOM API the compiler reads and edits. A full DOM via
// jsdom cost 1.5ms of window setup per compile and 280ms to load; this
// tree is plain objects and loads with parse5 alone. Only the compiler uses
// it; server rendering still runs components in a real DOM.

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';

export interface SourceAttribute {
  name: string;
  value: string;
}

export abstract class SourceNode {
  parentNode: SourceParentNode | null = null;
  // parse5's location for nodes parsed from source, as `dom.nodeLocation`
  // returned it with jsdom.
  sourceCodeLocation: Token.ElementLocation | null = null;
  // Tag handlers mark elements another handler already took (else branches).
  __htmsConsumed?: boolean;
  // Position in parentNode.childNodes, valid while the parent is indexed.
  siblingIndex = 0;

  constructor(readonly ownerDocument: SourceDocument | null) {}

  abstract readonly nodeType: number;
  abstract readonly nodeName: string;
  abstract get textContent(): string | null;
  abstract set textContent(value: string | null);
  abstract cloneNode(deep?: boolean): SourceNode;

  get nodeValue(): string | null {
    return null;
  }

  get parentElement(): SourceElement | null {
    const parent = this.parentNode;
    return parent instanceof SourceElement ? parent : null;
  }

  get previousSibling(): SourceNode | null {
    const parent = this.parentNode;
    if (!parent) return null;
    parent.reindex();
    return this.siblingIndex > 0
      ? (parent.childNodes.at(this.siblingIndex - 1) ?? null)
      : null;
  }

  get nextSibling(): SourceNode | null {
    const parent = this.parentNode;
    if (!parent) return null;
    parent.reindex();
    return parent.childNodes.at(this.siblingIndex + 1) ?? null;
  }

  get previousElementSibling(): SourceElement | null {
    let sibling = this.previousSibling;
    while (sibling && !(sibling instanceof SourceElement)) {
      sibling = sibling.previousSibling;
    }
    return sibling;
  }

  get nextElementSibling(): SourceElement | null {
    let sibling = this.nextSibling;
    while (sibling && !(sibling instanceof SourceElement)) {
      sibling = sibling.nextSibling;
    }
    return sibling;
  }

  get isConnected(): boolean {
    let root = this.parentNode;
    if (!root) return this.nodeType === 9;
    while (root.parentNode) root = root.parentNode;
    return root.nodeType === 9;
  }

  // The document nodes created next to this one belong to.
  nodeDocument(): SourceDocument {
    if (this.ownerDocument) return this.ownerDocument;
    if (this instanceof SourceDocument) return this;
    throw new Error('Node has no document');
  }

  contains(other: SourceNode | null): boolean {
    for (let node = other; node; node = node.parentNode) {
      if (node === this) return true;
    }
    return false;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  replaceWith(...nodes: Array<SourceNode | string>): void {
    const parent = this.parentNode;
    if (!parent) return;
    let next = this.nextSibling;
    while (next && nodes.includes(next)) next = next.nextSibling;
    parent.removeChild(this);
    for (const node of nodes) parent.insertBefore(parent.toNode(node), next);
  }
}

interface DescendantFrame {
  nodes: SourceNode[];
  index: number;
}

export abstract class SourceParentNode extends SourceNode {
  readonly childNodes: SourceNode[] = [];
  private indexed = true;
  private elementChildren: SourceElement[] | null = null;

  reindex(): void {
    if (this.indexed) return;
    let index = 0;
    for (const child of this.childNodes) child.siblingIndex = index++;
    this.indexed = true;
  }

  private mutated(): void {
    this.indexed = false;
    this.elementChildren = null;
  }

  get firstChild(): SourceNode | null {
    return this.childNodes.at(0) ?? null;
  }

  get lastChild(): SourceNode | null {
    return this.childNodes.at(-1) ?? null;
  }

  get children(): SourceElement[] {
    return (this.elementChildren ??= this.childNodes.filter(
      (node): node is SourceElement => node.nodeType === 1
    ));
  }

  get firstElementChild(): SourceElement | null {
    return this.children.at(0) ?? null;
  }

  get lastElementChild(): SourceElement | null {
    return this.children.at(-1) ?? null;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get textContent(): string | null {
    let text = '';
    for (const node of this.descendants()) {
      if (node instanceof SourceText) text += node.data;
    }
    return text;
  }

  set textContent(value: string | null) {
    this.replaceChildren();
    if (value) this.appendChild(new SourceText(value, this.nodeDocument()));
  }

  get innerHTML(): string {
    return serialize<SourceTreeMap>(this, { treeAdapter: TREE_ADAPTER });
  }

  // Every node under this one, in document order. Template contents are
  // separate trees and are not visited, as in the DOM.
  *descendants(): IterableIterator<SourceNode> {
    // One frame per open child list: the list and the next index to visit.
    const stack: DescendantFrame[] = [{ nodes: this.childNodes, index: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1) as DescendantFrame;
      if (frame.index >= frame.nodes.length) {
        stack.pop();
        continue;
      }
      const node = frame.nodes.at(frame.index++) as SourceNode;
      yield node;
      if (node instanceof SourceParentNode && node.childNodes.length > 0) {
        stack.push({ nodes: node.childNodes, index: 0 });
      }
    }
  }

  toNode(value: SourceNode | string): SourceNode {
    return typeof value === 'string'
      ? new SourceText(value, this.nodeDocument())
      : value;
  }

  appendChild<T extends SourceNode>(node: T): T {
    if (node instanceof SourceDocumentFragment) {
      for (const child of [...node.childNodes]) this.appendChild(child);
      return node;
    }
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    this.mutated();
    return node;
  }

  insertBefore<T extends SourceNode>(node: T, reference: SourceNode | null): T {
    if (reference === null) return this.appendChild(node);
    if (reference.parentNode !== this) {
      throw new Error(
        'The node before which the new node is to be inserted is not a child of this node.'
      );
    }
    if (node instanceof SourceDocumentFragment) {
      for (const child of [...node.childNodes])
        this.insertBefore(child, reference);
      return node;
    }
    if (node === reference) return node;
    node.remove();
    node.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, node);
    this.mutated();
    return node;
  }

  removeChild<T extends SourceNode>(node: T): T {
    const index = this.childNodes.indexOf(node);
    if (index < 0) {
      throw new Error('The node to be removed is not a child of this node.');
    }
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    this.mutated();
    return node;
  }

  append(...nodes: Array<SourceNode | string>): void {
    for (const node of nodes) this.appendChild(this.toNode(node));
  }

  replaceChildren(...nodes: Array<SourceNode | string>): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
    this.mutated();
    this.append(...nodes);
  }

  // css-select tests the given nodes and their descendants, so the search
  // starts from the children to exclude this node, as in the DOM.
  querySelectorAll(selector: string): SourceElement[] {
    return selectors().selectAll<SourceNode, SourceElement>(
      selector,
      this.childNodes,
      SELECT_OPTIONS
    );
  }

  querySelector(selector: string): SourceElement | null {
    return selectors().selectOne<SourceNode, SourceElement>(
      selector,
      this.childNodes,
      SELECT_OPTIONS
    );
  }

  getElementsByTagName(name: string): SourceElement[] {
    const lower = name.toLowerCase();
    const matches: SourceElement[] = [];
    for (const node of this.descendants()) {
      if (
        node instanceof SourceElement &&
        (name === '*' ||
          node.localName ===
            (node.namespaceURI === HTML_NAMESPACE ? lower : name))
      ) {
        matches.push(node);
      }
    }
    return matches;
  }

  cloneChildrenInto(target: SourceParentNode): void {
    for (const child of this.childNodes)
      target.appendChild(child.cloneNode(true));
  }
}

// The `class` attribute as an ordered set of tokens (DOMTokenList).
export class SourceClassList {
  constructor(private readonly element: SourceElement) {}

  private tokens(): string[] {
    const value = this.element.getAttribute('class');
    if (value === null) return [];
    const seen = new Set<string>();
    for (const token of value.split(/[\t\n\f\r ]+/)) {
      if (token) seen.add(token);
    }
    return [...seen];
  }

  private update(tokens: string[]): void {
    if (tokens.length === 0 && !this.element.hasAttribute('class')) return;
    this.element.setAttribute('class', tokens.join(' '));
  }

  get length(): number {
    return this.tokens().length;
  }

  get value(): string {
    return this.element.getAttribute('class') ?? '';
  }

  contains(token: string): boolean {
    return this.tokens().includes(token);
  }

  add(...names: string[]): void {
    const tokens = this.tokens();
    for (const name of names) {
      if (!tokens.includes(name)) tokens.push(name);
    }
    this.update(tokens);
  }

  remove(...names: string[]): void {
    this.update(this.tokens().filter((token) => !names.includes(token)));
  }

  toggle(token: string, force?: boolean): boolean {
    const present = this.contains(token);
    if (present && force !== true) {
      this.remove(token);
      return false;
    }
    if (!present && force !== false) {
      this.add(token);
      return true;
    }
    return present;
  }
}

function qualifiedAttributeName(attribute: Token.Attribute): string {
  return attribute.prefix
    ? `${attribute.prefix}:${attribute.name}`
    : attribute.name;
}

export class SourceElement extends SourceParentNode {
  readonly nodeType = 1;
  // Upper case for HTML elements, as in an HTML document; SVG and MathML
  // names keep their case.
  readonly tagName: string;
  // Template contents; null for every other element.
  content: SourceDocumentFragment | null = null;
  // Creation order within the parse that built this element, or -1 for
  // elements made afterwards. Parsing the same source again creates the
  // same elements in the same order, which is how a document finds the
  // location of an element parsed without locations (see `locationOf`).
  ordinal = -1;

  constructor(
    readonly localName: string,
    readonly namespaceURI: string,
    // parse5's attribute records: `name` is the local name and `prefix` is
    // set for xlink:, xml: and xmlns: attributes.
    readonly attrs: Token.Attribute[],
    ownerDocument: SourceDocument
  ) {
    super(ownerDocument);
    this.tagName =
      namespaceURI === HTML_NAMESPACE ? localName.toUpperCase() : localName;
  }

  get nodeName(): string {
    return this.tagName;
  }

  get attributes(): SourceAttribute[] {
    return this.attrs.map((attribute) => ({
      name: qualifiedAttributeName(attribute),
      value: attribute.value,
    }));
  }

  // Attribute names are case-insensitive on HTML elements.
  private attributeName(name: string): string {
    return this.namespaceURI === HTML_NAMESPACE ? name.toLowerCase() : name;
  }

  private findAttribute(name: string): Token.Attribute | undefined {
    const key = this.attributeName(name);
    return this.attrs.find(
      (attribute) => qualifiedAttributeName(attribute) === key
    );
  }

  getAttribute(name: string): string | null {
    return this.findAttribute(name)?.value ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.findAttribute(name) !== undefined;
  }

  hasAttributes(): boolean {
    return this.attrs.length > 0;
  }

  getAttributeNames(): string[] {
    return this.attrs.map(qualifiedAttributeName);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.findAttribute(name);
    if (existing) {
      existing.value = String(value);
    } else {
      this.attrs.push({ name: this.attributeName(name), value: String(value) });
    }
  }

  removeAttribute(name: string): void {
    const existing = this.findAttribute(name);
    if (existing) this.attrs.splice(this.attrs.indexOf(existing), 1);
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(value: string) {
    this.setAttribute('id', value);
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  private classes: SourceClassList | null = null;

  get classList(): SourceClassList {
    return (this.classes ??= new SourceClassList(this));
  }

  get outerHTML(): string {
    return serializeOuter<SourceTreeMap>(this, { treeAdapter: TREE_ADAPTER });
  }

  get innerHTML(): string {
    return serialize<SourceTreeMap>(this, { treeAdapter: TREE_ADAPTER });
  }

  // Parses markup in this element's context (so <tr> works inside a table
  // and anything inside a <template>) and replaces the children with it.
  set innerHTML(markup: string) {
    currentDocument = this.nodeDocument();
    const fragment = parseFragment<SourceTreeMap>(this, markup, {
      treeAdapter: TREE_ADAPTER,
    });
    const target = this.content ?? this;
    target.replaceChildren();
    for (const child of [...fragment.childNodes]) target.appendChild(child);
  }

  matches(selector: string): boolean {
    return selectors().is<SourceNode, SourceElement>(
      this,
      selector,
      SELECT_OPTIONS
    );
  }

  closest(selector: string): SourceElement | null {
    if (this.matches(selector)) return this;
    for (
      let element = this.parentElement;
      element;
      element = element.parentElement
    ) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  cloneNode(deep = false): SourceElement {
    const clone = new SourceElement(
      this.localName,
      this.namespaceURI,
      this.attrs.map((attribute) => ({ ...attribute })),
      this.nodeDocument()
    );
    if (this.content) {
      clone.content = new SourceDocumentFragment(clone.nodeDocument());
      if (deep) this.content.cloneChildrenInto(clone.content);
    }
    if (deep) this.cloneChildrenInto(clone);
    return clone;
  }
}

export class SourceText extends SourceNode {
  readonly nodeType = 3;
  readonly nodeName = '#text';

  constructor(
    public data: string,
    ownerDocument: SourceDocument
  ) {
    super(ownerDocument);
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string | null) {
    this.data = value ?? '';
  }

  get nodeValue(): string {
    return this.data;
  }

  cloneNode(): SourceText {
    return new SourceText(this.data, this.nodeDocument());
  }
}

export class SourceComment extends SourceNode {
  readonly nodeType = 8;
  readonly nodeName = '#comment';

  constructor(
    public data: string,
    ownerDocument: SourceDocument
  ) {
    super(ownerDocument);
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string | null) {
    this.data = value ?? '';
  }

  get nodeValue(): string {
    return this.data;
  }

  cloneNode(): SourceComment {
    return new SourceComment(this.data, this.nodeDocument());
  }
}

export class SourceDocumentType extends SourceNode {
  readonly nodeType = 10;

  constructor(
    public name: string,
    public publicId: string,
    public systemId: string,
    ownerDocument: SourceDocument
  ) {
    super(ownerDocument);
  }

  get nodeName(): string {
    return this.name;
  }

  get textContent(): null {
    return null;
  }

  set textContent(_value: string | null) {
    // Document types have no text.
  }

  cloneNode(): SourceDocumentType {
    return new SourceDocumentType(
      this.name,
      this.publicId,
      this.systemId,
      this.nodeDocument()
    );
  }
}

export class SourceDocumentFragment extends SourceParentNode {
  readonly nodeType = 11;
  readonly nodeName = '#document-fragment';

  constructor(ownerDocument: SourceDocument) {
    super(ownerDocument);
  }

  cloneNode(deep = false): SourceDocumentFragment {
    const clone = new SourceDocumentFragment(this.nodeDocument());
    if (deep) this.cloneChildrenInto(clone);
    return clone;
  }
}

export class SourceDocument extends SourceParentNode {
  readonly nodeType = 9;
  readonly nodeName = '#document';
  mode: html.DOCUMENT_MODE = html.DOCUMENT_MODE.NO_QUIRKS;

  constructor() {
    super(null);
  }

  get textContent(): null {
    return null;
  }

  set textContent(_value: string | null) {
    // Setting a document's text does nothing, as in the DOM.
  }

  get documentElement(): SourceElement | null {
    return this.firstElementChild;
  }

  private htmlChild(name: string): SourceElement | null {
    return (
      this.documentElement?.children.find(
        (child) =>
          child.localName === name && child.namespaceURI === HTML_NAMESPACE
      ) ?? null
    );
  }

  get head(): SourceElement | null {
    return this.htmlChild('head');
  }

  get body(): SourceElement | null {
    return this.htmlChild('body');
  }

  createElement(name: string): SourceElement {
    return this.createElementNS(HTML_NAMESPACE, name.toLowerCase());
  }

  createElementNS(
    namespace: string | null,
    qualifiedName: string
  ): SourceElement {
    const colon = qualifiedName.indexOf(':');
    const localName =
      colon >= 0 ? qualifiedName.slice(colon + 1) : qualifiedName;
    const element = new SourceElement(localName, namespace ?? '', [], this);
    if (namespace === HTML_NAMESPACE && localName === 'template') {
      element.content = new SourceDocumentFragment(this);
    }
    return element;
  }

  createTextNode(data: string): SourceText {
    return new SourceText(data, this);
  }

  createComment(data: string): SourceComment {
    return new SourceComment(data, this);
  }

  createDocumentFragment(): SourceDocumentFragment {
    return new SourceDocumentFragment(this);
  }

  cloneNode(deep = false): SourceDocument {
    const clone = new SourceDocument();
    clone.mode = this.mode;
    if (deep) this.cloneChildrenInto(clone);
    return clone;
  }

  // Set by a caller that parsed this document without locations (location
  // tracking doubles parse time) and can parse the same source again with
  // them, should a diagnostic need one.
  locationSource: (() => SourceDocument) | null = null;
  private locationsByOrdinal: Map<number, Token.ElementLocation> | null = null;

  // The source location of an element parsed into this document, read from
  // the element itself or, lazily, from a located parse of the same source.
  locationOf(element: SourceElement): Token.ElementLocation | null {
    if (element.sourceCodeLocation) return element.sourceCodeLocation;
    if (element.ordinal < 0 || !this.locationSource) return null;
    if (!this.locationsByOrdinal) {
      const locations = new Map<number, Token.ElementLocation>();
      const visit = (parent: SourceParentNode): void => {
        for (const child of parent.childNodes) {
          if (!(child instanceof SourceElement)) continue;
          if (child.ordinal >= 0 && child.sourceCodeLocation) {
            locations.set(child.ordinal, child.sourceCodeLocation);
          }
          visit(child);
          if (child.content) visit(child.content);
        }
      };
      visit(this.locationSource());
      this.locationsByOrdinal = locations;
    }
    return this.locationsByOrdinal.get(element.ordinal) ?? null;
  }
}

// parse5 builds and serializes the tree through this adapter. Nodes without
// a parent to inherit a document from belong to the document being parsed.
type SourceTreeMap = TreeAdapterTypeMap<
  SourceNode,
  SourceParentNode,
  SourceNode,
  SourceDocument,
  SourceDocumentFragment,
  SourceElement,
  SourceComment,
  SourceText,
  SourceElement,
  SourceDocumentType
>;

let currentDocument: SourceDocument | null = null;
// Next element ordinal while a document is parsed; -1 outside parseDocument
// (fragments parsed into an existing tree get no ordinal).
let nextOrdinal = -1;

function parsingDocument(): SourceDocument {
  if (!currentDocument) throw new Error('No document is being parsed');
  return currentDocument;
}

const TREE_ADAPTER: TreeAdapter<SourceTreeMap> = {
  createDocument() {
    currentDocument = new SourceDocument();
    return currentDocument;
  },
  createDocumentFragment() {
    return new SourceDocumentFragment(parsingDocument());
  },
  createElement(tagName, namespaceURI, attrs) {
    const element = new SourceElement(
      tagName,
      namespaceURI,
      attrs,
      parsingDocument()
    );
    if (nextOrdinal >= 0) {
      element.ordinal = nextOrdinal;
      nextOrdinal += 1;
    }
    return element;
  },
  createCommentNode(data) {
    return new SourceComment(data, parsingDocument());
  },
  createTextNode(value) {
    return new SourceText(value, parsingDocument());
  },
  appendChild(parentNode, newNode) {
    parentNode.appendChild(newNode);
  },
  insertBefore(parentNode, newNode, referenceNode) {
    parentNode.insertBefore(newNode, referenceNode);
  },
  setTemplateContent(templateElement, contentElement) {
    templateElement.content = contentElement;
  },
  getTemplateContent(templateElement) {
    return (templateElement.content ??= new SourceDocumentFragment(
      templateElement.nodeDocument()
    ));
  },
  setDocumentType(document, name, publicId, systemId) {
    const existing = document.childNodes.find(
      (node) => node instanceof SourceDocumentType
    );
    if (existing) {
      existing.name = name;
      existing.publicId = publicId;
      existing.systemId = systemId;
    } else {
      document.appendChild(
        new SourceDocumentType(name, publicId, systemId, document)
      );
    }
  },
  setDocumentMode(document, mode) {
    document.mode = mode;
  },
  getDocumentMode(document) {
    return document.mode;
  },
  detachNode(node) {
    node.remove();
  },
  insertText(parentNode, text) {
    const last = parentNode.lastChild;
    if (last instanceof SourceText) {
      last.data += text;
    } else {
      parentNode.appendChild(new SourceText(text, parentNode.nodeDocument()));
    }
  },
  insertTextBefore(parentNode, text, referenceNode) {
    const previous = referenceNode.previousSibling;
    if (previous instanceof SourceText) {
      previous.data += text;
    } else {
      parentNode.insertBefore(
        new SourceText(text, parentNode.nodeDocument()),
        referenceNode
      );
    }
  },
  adoptAttributes(recipient, attrs) {
    const names = new Set(recipient.attrs.map((attribute) => attribute.name));
    for (const attribute of attrs) {
      if (!names.has(attribute.name)) recipient.attrs.push(attribute);
    }
  },
  getFirstChild(node) {
    return node.firstChild;
  },
  getChildNodes(node) {
    return node.childNodes;
  },
  getParentNode(node) {
    return node.parentNode;
  },
  getAttrList(element) {
    return element.attrs;
  },
  getTagName(element) {
    return element.localName;
  },
  getNamespaceURI(element) {
    return element.namespaceURI as html.NS;
  },
  getTextNodeContent(textNode) {
    return textNode.data;
  },
  getCommentNodeContent(commentNode) {
    return commentNode.data;
  },
  getDocumentTypeNodeName(doctypeNode) {
    return doctypeNode.name;
  },
  getDocumentTypeNodePublicId(doctypeNode) {
    return doctypeNode.publicId;
  },
  getDocumentTypeNodeSystemId(doctypeNode) {
    return doctypeNode.systemId;
  },
  isTextNode(node): node is SourceText {
    return node instanceof SourceText;
  },
  isCommentNode(node): node is SourceComment {
    return node instanceof SourceComment;
  },
  isDocumentTypeNode(node): node is SourceDocumentType {
    return node instanceof SourceDocumentType;
  },
  isElementNode(node): node is SourceElement {
    return node instanceof SourceElement;
  },
  setNodeSourceCodeLocation(node, location) {
    node.sourceCodeLocation = location;
  },
  getNodeSourceCodeLocation(node) {
    return node.sourceCodeLocation;
  },
  updateNodeSourceCodeLocation(node, endLocation) {
    node.sourceCodeLocation = {
      ...node.sourceCodeLocation,
      ...endLocation,
    } as Token.ElementLocation;
  },
};

// css-select resolves selectors over the tree through this adapter.
function removeSubsets(nodes: SourceNode[]): SourceNode[] {
  let index = nodes.length;
  while (--index >= 0) {
    const node = nodes.at(index) as SourceNode;
    if (index > 0 && nodes.lastIndexOf(node, index - 1) >= 0) {
      nodes.splice(index, 1);
      continue;
    }
    for (
      let ancestor = node.parentNode;
      ancestor;
      ancestor = ancestor.parentNode
    ) {
      if (nodes.includes(ancestor)) {
        nodes.splice(index, 1);
        break;
      }
    }
  }
  return nodes;
}

// The tree changes between queries, so matches are not cached.
const SELECT_OPTIONS: Options<SourceNode, SourceElement> = {
  adapter: {
    isTag: (node): node is SourceElement => node.nodeType === 1,
    getAttributeValue: (element, name) =>
      element.getAttribute(name) ?? undefined,
    getChildren: (node) =>
      node instanceof SourceParentNode ? node.childNodes : [],
    getName: (element) => element.localName.toLowerCase(),
    getParent: (element) => element.parentNode,
    getSiblings: (node) =>
      node.parentNode ? node.parentNode.childNodes : [node],
    getText: (node) => node.textContent ?? '',
    hasAttrib: (element, name) => element.hasAttribute(name),
    removeSubsets,
    prevElementSibling: (node) => node.previousElementSibling,
  },
  cacheResults: false,
};

export interface ParseDocumentOptions {
  // Record each node's line and column in `sourceCodeLocation`.
  locations?: boolean;
}

// Parses a complete HTML document with the browsers' algorithm (scripting
// enabled, so <noscript> content is text, as jsdom parsed it).
export function parseDocument(
  source: string,
  options: ParseDocumentOptions = {}
): SourceDocument {
  nextOrdinal = 0;
  try {
    return parse<SourceTreeMap>(source, {
      treeAdapter: TREE_ADAPTER,
      sourceCodeLocationInfo: options.locations === true,
    });
  } finally {
    nextOrdinal = -1;
  }
}
