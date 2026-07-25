import { CompilerError } from '../types';
import { SecurityValidator } from '../utils/security';
import { TemplateNode } from './ir';

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

export function collectTemplateSecurityErrors(
  element: Element
): CompilerError[] {
  const errors: CompilerError[] = [];

  for (const attr of Array.from(element.attributes)) {
    errors.push(
      ...SecurityValidator.validateHtmlAttribute(attr.name, attr.value).map(
        (error) => ({ ...error, tag: element.tagName.toUpperCase() })
      )
    );
  }

  for (const child of templateChildNodes(element)) {
    if (child.nodeType === 3 && child.textContent) {
      errors.push(
        ...SecurityValidator.validateContent(child.textContent).map(
          (error) => ({
            ...error,
            tag: element.tagName.toUpperCase(),
          })
        )
      );
    } else if (child.nodeType === 1) {
      errors.push(...collectTemplateSecurityErrors(child as Element));
    }
  }

  return errors;
}

export function elementToTemplateNode(element: Element): TemplateNode {
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    if (
      SecurityValidator.validateHtmlAttribute(attr.name, attr.value).length ===
      0
    ) {
      attributes[attr.name] = attr.value;
    }
  }

  const children: TemplateNode[] = [];
  for (const child of templateChildNodes(element)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? '';
      if (text.trim().length === 0) {
        continue;
      }
      children.push({ type: 'text', textContent: text });
    } else if (child.nodeType === 1) {
      const elementChild = child as Element;
      if (isTemplateElement(elementChild)) {
        children.push(elementToTemplateNode(elementChild));
      }
    }
  }

  return {
    type: 'element',
    tagName: element.tagName.toLowerCase(),
    namespace: templateNamespace(element),
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

export function nodeListToTemplateNodes(nodes: NodeList): TemplateNode[] {
  const templateNodes: TemplateNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (text.trim().length === 0) {
        continue;
      }
      templateNodes.push({ type: 'text', textContent: text });
    } else if (node.nodeType === 1 && isTemplateElement(node)) {
      templateNodes.push(elementToTemplateNode(node));
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
