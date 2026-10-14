import {
  RAW_TEXT_ELEMENTS,
  VOID_ELEMENTS,
  escapeHtml,
} from './template-serializer';

// The block compiler serializes a planned template to HTML and clones the
// parsed result at runtime, so the parsed tree must match the plan exactly.
// Checking that by parsing the HTML costs a parse per block; most templates
// use only markup the HTML parser never restructures, and this module
// recognises those shapes so they skip the parse. Anything it does not
// recognise is still verified by parsing.

export type TemplateShapeNode =
  | {
      kind: 'element';
      tag: string;
      ns: 'html' | 'svg' | 'mathml';
      attrs: ReadonlyArray<readonly [string, string]>;
      children: TemplateShapeNode[];
    }
  | { kind: 'text'; text: string; dynamic: boolean }
  | { kind: 'comment'; data: string };

type ShapeElement = Extract<TemplateShapeNode, { kind: 'element' }>;

const WHITESPACE_TAGS = new Set(['pre', 'textarea', 'listing']);

// The HTML the block compiler builds its template from. Dynamic text is a
// placeholder space and raw-text content is emitted verbatim.
export function templateNodeHtml(
  node: TemplateShapeNode,
  parent: ShapeElement | null
): string {
  if (node.kind === 'comment') {
    return `<!--${node.data}-->`;
  }
  if (node.kind === 'text') {
    if (node.dynamic) return ' ';
    if (parent && parent.ns === 'html' && RAW_TEXT_ELEMENTS.has(parent.tag)) {
      return node.text.replace(/<\/(style|script)/gi, '<\\/$1');
    }
    return escapeHtml(node.text);
  }
  const attrs = node.attrs
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');
  if (node.ns === 'html' && VOID_ELEMENTS.has(node.tag)) {
    return `<${node.tag}${attrs}>`;
  }
  let children = node.children
    .map((child) => templateNodeHtml(child, node))
    .join('');
  const first = node.children[0];
  if (
    node.ns === 'html' &&
    WHITESPACE_TAGS.has(node.tag) &&
    first?.kind === 'text' &&
    !first.dynamic &&
    first.text.startsWith('\n')
  ) {
    // The parser drops one leading newline in these elements.
    children = `\n${children}`;
  }
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

// HTML elements the "in body" insertion mode inserts where they are
// written, given the nesting rules checked below. Left out: anything with
// implied end tags (li is handled, dd/dt/option/rt are not), table parts,
// raw-text and whitespace-sensitive elements, <select>, <template>,
// <image> (renamed to img), the head/html/body/frameset family, scope
// markers (applet, marquee, object) and nobr/ruby. Custom elements (names
// with a hyphen) are "any other start tag" and always plain.
const PLAIN_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'bdi',
  'bdo',
  'big',
  'blockquote',
  'br',
  'button',
  'canvas',
  'center',
  'cite',
  'code',
  'data',
  'datalist',
  'del',
  'details',
  'dfn',
  'dialog',
  'dir',
  'div',
  'dl',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'font',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'map',
  'mark',
  'menu',
  'meter',
  'nav',
  'ol',
  'output',
  'p',
  'picture',
  'progress',
  'q',
  's',
  'samp',
  'search',
  'section',
  'slot',
  'small',
  'source',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'time',
  'track',
  'tt',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
]);

// Void elements among the plain tags: serialized without an end tag, so
// they must have no children.
const PLAIN_VOID_TAGS = new Set([
  'area',
  'br',
  'embed',
  'hr',
  'img',
  'input',
  'source',
  'track',
  'wbr',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Start tags that close an open <p> (the "in body" rules for the div
// group, headings, pre/listing, form, li, dd/dt, hr, xmp, plaintext and
// table). Any of these inside a <p> is moved out of it.
const P_CLOSERS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'search',
  'section',
  'summary',
  'ul',
  ...HEADINGS,
  'pre',
  'listing',
  'form',
  'li',
  'dd',
  'dt',
  'hr',
  'xmp',
  'plaintext',
  'table',
]);

// An <li> start tag closes an open <li> unless an element in the parser's
// "special" category other than address, div and p lies between them.
// These are the plain tags in that category.
const LI_SCOPE_STOPS = new Set([
  'area',
  'article',
  'aside',
  'blockquote',
  'br',
  'button',
  'center',
  'details',
  'dialog',
  'dir',
  'dl',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  ...HEADINGS,
  'header',
  'hgroup',
  'hr',
  'img',
  'input',
  'main',
  'menu',
  'nav',
  'ol',
  'search',
  'section',
  'source',
  'summary',
  'track',
  'ul',
  'wbr',
]);

// Elements whose start tag is dropped or that restructure when nested in
// an element of the same name at any depth: a second <a> runs the
// adoption agency, a <button> in scope is closed first, a nested <form>
// is ignored while the form pointer is set.
const UNNESTABLE = new Set(['a', 'button', 'form']);

// Tag names serialize unchanged only in lower case, and a custom element
// is any other hyphenated name.
const PLAIN_TAG_NAME = /^[a-z][a-z0-9._-]*$/;
// Characters that end or break an attribute name in the tokenizer.
const ATTRIBUTE_NAME = /^[^\s"'<>/=\0]+$/;
// Comment data that the tokenizer reads back unchanged and in one piece.
const PLAIN_COMMENT = /^[^<>\-\0\r]*$/;
// Text the tokenizer alters: NUL is dropped and CR normalised.
const ALTERED_TEXT = /[\0\r]/;

// True when parsing `templateNodeHtml` of these nodes is guaranteed to
// produce exactly this node structure (tags, text and comment positions).
// False means "verify by parsing", not "restructured".
export function isPlainTemplate(roots: readonly TemplateShapeNode[]): boolean {
  return plainChildren(roots, []);
}

function plainChildren(
  nodes: readonly TemplateShapeNode[],
  ancestors: string[]
): boolean {
  let previousWasText = false;
  for (const node of nodes) {
    if (node.kind === 'text') {
      // Adjacent text nodes merge; empty text produces no node at all.
      if (previousWasText) return false;
      previousWasText = true;
      if (!node.dynamic && (node.text === '' || ALTERED_TEXT.test(node.text))) {
        return false;
      }
      continue;
    }
    previousWasText = false;
    if (node.kind === 'comment') {
      if (!PLAIN_COMMENT.test(node.data)) return false;
      continue;
    }
    if (!plainElement(node, ancestors)) return false;
  }
  return true;
}

function plainElement(node: ShapeElement, ancestors: string[]): boolean {
  const tag = node.tag;
  if (
    node.ns !== 'html' ||
    !PLAIN_TAG_NAME.test(tag) ||
    !(PLAIN_TAGS.has(tag) || tag.includes('-'))
  ) {
    return false;
  }
  for (const [name] of node.attrs) {
    if (!ATTRIBUTE_NAME.test(name)) return false;
  }
  if (P_CLOSERS.has(tag) && ancestors.includes('p')) return false;
  if (HEADINGS.has(tag) && HEADINGS.has(ancestors.at(-1) ?? '')) return false;
  if (UNNESTABLE.has(tag) && ancestors.includes(tag)) return false;
  if (tag === 'li' && !listItemAllowed(ancestors)) return false;
  if (PLAIN_VOID_TAGS.has(tag)) return node.children.length === 0;
  ancestors.push(tag);
  const plain = plainChildren(node.children, ancestors);
  ancestors.pop();
  return plain;
}

function listItemAllowed(ancestors: string[]): boolean {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors.at(index) as string;
    if (ancestor === 'li') return false;
    if (LI_SCOPE_STOPS.has(ancestor)) return true;
  }
  return true;
}
