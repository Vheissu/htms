import { CompilerError, CompilerWarning } from '../types';
import { SecurityValidator } from '../utils/security';
import { TemplateBinding, TemplateChild, TemplateNode } from './ir';
import { isBindingAttribute, parseBindingAttribute } from './bindings';

// Resolves a non-template child element (an HTMS directive tag such as
// <event> or <if>) into template children: embedded directives and/or
// nested template nodes. Returning an empty array drops the element.
export type ChildResolver = (element: Element) => TemplateChild[];

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
const NATIVE_HTML_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'menu',
  'meta',
  'meter',
  'nav',
  'noscript',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'search',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'video',
  'wbr',
]);
const HTMS_DIRECTIVE_TAGS = new Set([
  'append',
  'array',
  'bind',
  'call',
  'class',
  'comment',
  'derive',
  'effect',
  'else',
  'else-if',
  'elseif',
  'emit',
  'event',
  'fetch',
  'function',
  'if',
  'inject',
  'keyedlist',
  'model',
  'object',
  'print',
  'push',
  'repeat',
  'set',
  'setattr',
  'setprop',
  'show',
  'splice',
  'submit',
  'switch',
  'toggle',
  'var',
  'while',
]);

// Elements whose whitespace is significant and must be kept verbatim.
const WHITESPACE_PRESERVING_TAGS = new Set(['pre', 'textarea', 'listing']);

export function preservesWhitespace(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    if (WHITESPACE_PRESERVING_TAGS.has(current.localName)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// Decides what a source text node contributes to the template. Text with
// visible characters is kept as written. Whitespace-only text is dropped at
// the edges of its parent and when it spans a line break (source
// formatting), but a single space between two inline siblings is kept, so
// `<b>Hi</b> <em>there</em>` still renders "Hi there".
export function templateTextValue(node: Node): string | null {
  const text = node.textContent ?? '';
  if (text.length === 0) {
    return null;
  }
  if (preservesWhitespace(node.parentElement)) {
    return text;
  }
  if (text.trim().length > 0) {
    return text;
  }
  if (/[\n\r]/.test(text) || !node.previousSibling || !node.nextSibling) {
    return null;
  }
  return ' ';
}

function templateNamespace(element: Element): TemplateNode['namespace'] {
  if (element.namespaceURI === SVG_NAMESPACE) {
    return 'svg';
  }
  if (element.namespaceURI === MATHML_NAMESPACE) {
    return 'mathml';
  }
  return 'html';
}

function templateChildNodes(element: Element): Node[] {
  if (
    element.namespaceURI === HTML_NAMESPACE &&
    element.tagName.toLowerCase() === 'template' &&
    'content' in element
  ) {
    return Array.from((element as HTMLTemplateElement).content.childNodes);
  }
  return Array.from(element.childNodes);
}

// Checks a markup subtree: attribute names and values, text content and
// inline binding syntax. Directive tags nested in the markup are skipped;
// their handlers validate them.
export function collectTemplateSecurityErrors(
  element: Element
): CompilerError[] {
  const errors: CompilerError[] = [];
  const tag = element.tagName.toUpperCase();

  for (const attr of Array.from(element.attributes)) {
    if (isBindingAttribute(attr.name)) {
      errors.push(
        ...SecurityValidator.validateContent(attr.value).map((error) => ({
          ...error,
          tag,
        }))
      );
      const parsed = parseBindingAttribute(attr.name, attr.value, element);
      if (parsed.error) {
        errors.push({
          type: 'validation',
          message: parsed.error,
          tag,
        });
      }
      continue;
    }
    errors.push(
      ...SecurityValidator.validateHtmlAttribute(attr.name, attr.value).map(
        (error) => ({ ...error, tag })
      )
    );
  }

  for (const child of templateChildNodes(element)) {
    if (child.nodeType === 3 && child.textContent) {
      errors.push(
        ...SecurityValidator.validateContent(child.textContent).map(
          (error) => ({
            ...error,
            tag,
          })
        )
      );
    } else if (child.nodeType === 1 && isTemplateElement(child)) {
      errors.push(...collectTemplateSecurityErrors(child as Element));
    }
  }

  return errors;
}

// Invalid binding syntax is always an error. Security findings are errors
// in strict mode and warnings otherwise (the offending attribute or text is
// dropped from the output either way).
export function partitionTemplateErrors(
  found: CompilerError[],
  strictMode: boolean
): { errors: CompilerError[]; warnings: CompilerWarning[] } {
  const errors: CompilerError[] = [];
  const warnings: CompilerWarning[] = [];
  for (const error of found) {
    if (strictMode || error.type === 'validation') {
      errors.push(error);
    } else {
      warnings.push({ message: error.message, tag: error.tag });
    }
  }
  return { errors, warnings };
}

export function elementToTemplateNode(
  element: Element,
  resolveChild?: ChildResolver
): TemplateNode {
  const attributes: Record<string, string> = {};
  const bindings: TemplateBinding[] = [];
  for (const attr of Array.from(element.attributes)) {
    if (isBindingAttribute(attr.name)) {
      // Invalid bindings are reported by collectTemplateSecurityErrors.
      const parsed = parseBindingAttribute(attr.name, attr.value, element);
      if (
        parsed.binding &&
        SecurityValidator.validateContent(attr.value).length === 0
      ) {
        bindings.push(parsed.binding);
      }
      continue;
    }
    if (
      SecurityValidator.validateHtmlAttribute(attr.name, attr.value).length ===
      0
    ) {
      attributes[attr.name] = attr.value;
    }
  }

  const children: TemplateChild[] = [];
  for (const child of templateChildNodes(element)) {
    if (child.nodeType === 3) {
      const text = templateTextValue(child);
      if (text === null) {
        continue;
      }
      children.push({ type: 'text', textContent: text });
    } else if (child.nodeType === 1) {
      const elementChild = child as Element;
      if (isTemplateElement(elementChild)) {
        children.push(elementToTemplateNode(elementChild, resolveChild));
        continue;
      }
      if (resolveChild) {
        children.push(...resolveChild(elementChild));
      }
    }
  }

  return {
    type: 'element',
    // localName keeps SVG/MathML case (linearGradient, foreignObject);
    // HTML element local names are already lower case.
    tagName: element.localName,
    namespace: templateNamespace(element),
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    bindings: bindings.length > 0 ? bindings : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

export function nodeListToTemplateNodes(
  nodes: NodeList,
  resolveChild?: ChildResolver
): TemplateNode[] {
  const templateNodes: TemplateNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 3) {
      const text = templateTextValue(node);
      if (text === null) {
        continue;
      }
      templateNodes.push({ type: 'text', textContent: text });
    } else if (node.nodeType === 1 && isTemplateElement(node)) {
      templateNodes.push(elementToTemplateNode(node, resolveChild));
    }
  }
  return templateNodes;
}

export function isTemplateElement(node: Node): node is Element {
  if (node.nodeType !== 1) {
    return false;
  }

  const element = node as Element;
  if (element.namespaceURI !== HTML_NAMESPACE) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  if (HTMS_DIRECTIVE_TAGS.has(tagName)) {
    return false;
  }
  if (tagName.includes('-')) {
    return true;
  }

  return NATIVE_HTML_TAGS.has(tagName);
}

// Kept as an alias while tag handlers migrate to the clearer name.
export const isLowerCaseTag = isTemplateElement;
