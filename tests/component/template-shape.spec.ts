import {
  isPlainTemplate,
  templateNodeHtml,
  TemplateShapeNode,
} from '../../src/component/template-shape';
import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  parseDocument,
  SourceDocumentFragment,
  SourceElement,
  SourceNode,
  SourceParentNode,
  SourceText,
  SVG_NAMESPACE,
} from '../../src/source-dom';

// `isPlainTemplate` lets the block compiler skip parsing a template to
// check the HTML parser keeps its structure. It must never accept a
// template the parser would restructure, so it is checked against the
// parser itself on random trees that mix ordinary markup with the
// constructs the parser does move: li in li, blocks in p, nested a/button/
// form, headings in headings, table parts, raw-text elements, merged and
// empty text, broken comments.

type ShapeElement = Extract<TemplateShapeNode, { kind: 'element' }>;

const TAGS = [
  'div',
  'span',
  'p',
  'ul',
  'ol',
  'li',
  'a',
  'button',
  'form',
  'label',
  'input',
  'img',
  'br',
  'h1',
  'h2',
  'section',
  'header',
  'strong',
  'em',
  'code',
  'my-widget',
  'x-item',
  'menu',
  'summary',
  'details',
  'dl',
  'dd',
  'dt',
  'table',
  'tr',
  'td',
  'select',
  'option',
  'pre',
  'textarea',
  'template',
  'script',
  'nobr',
  'image',
  'IMG',
  'address',
  'hr',
  'canvas',
  'video',
];

const TEXTS = ['x', 'hello world', ' ', '', 'a\0b', 'a\rb', 'a & b < c > "d"'];
const COMMENTS = ['', 'note', 'a-b', '>x', 'a>b', '<!--x', 'a--b'];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(next: () => number, items: readonly T[]): T {
  return items.at(Math.floor(next() * items.length)) as T;
}

function randomNode(next: () => number, depth: number): TemplateShapeNode {
  const roll = next();
  if (roll < 0.25 || depth > 4) {
    return next() < 0.3
      ? { kind: 'text', text: '', dynamic: true }
      : { kind: 'text', text: pick(next, TEXTS), dynamic: false };
  }
  if (roll < 0.32) {
    return { kind: 'comment', data: pick(next, COMMENTS) };
  }
  const children: TemplateShapeNode[] = [];
  const count = Math.floor(next() * 4);
  for (let index = 0; index < count; index += 1) {
    children.push(randomNode(next, depth + 1));
  }
  const attrs: Array<[string, string]> = [];
  if (next() < 0.4) attrs.push(['class', 'a b']);
  if (next() < 0.2) attrs.push(['data-x', 'q"q']);
  if (next() < 0.05) attrs.push(['bad name', '1']);
  return {
    kind: 'element',
    tag: pick(next, TAGS),
    ns: 'html',
    attrs,
    children,
  };
}

function randomRoots(next: () => number): TemplateShapeNode[] {
  const roots: TemplateShapeNode[] = [];
  const count = 1 + Math.floor(next() * 3);
  for (let index = 0; index < count; index += 1) {
    roots.push(randomNode(next, 0));
  }
  return roots;
}

// The block compiler's check: parse the template HTML and compare.
function parserKeepsStructure(roots: TemplateShapeNode[]): boolean {
  const document = parseDocument('<!doctype html><body>');
  const template = document.createElement('template');
  template.innerHTML = roots
    .map((node) => templateNodeHtml(node, null))
    .join('');
  return sameStructure(template.content as SourceDocumentFragment, roots);
}

function sameStructure(
  parsed: SourceNode,
  nodes: TemplateShapeNode[]
): boolean {
  const children =
    parsed instanceof SourceParentNode ? Array.from(parsed.childNodes) : [];
  if (children.length !== nodes.length) return false;
  return nodes.every((node, index) => {
    const actual = children.at(index) as SourceNode;
    if (node.kind === 'comment') return actual.nodeType === 8;
    if (node.kind === 'text') {
      return (
        actual.nodeType === 3 &&
        (node.dynamic || (actual as SourceText).data === node.text)
      );
    }
    if (actual.nodeType !== 1) return false;
    const element = actual as SourceElement;
    const namespace =
      node.ns === 'svg'
        ? SVG_NAMESPACE
        : node.ns === 'mathml'
          ? MATHML_NAMESPACE
          : HTML_NAMESPACE;
    if (element.localName !== node.tag || element.namespaceURI !== namespace) {
      return false;
    }
    if (node.ns === 'html' && node.tag === 'template') return true;
    return sameStructure(element, node.children);
  });
}

function element(
  tag: string,
  children: TemplateShapeNode[] = [],
  attrs: Array<[string, string]> = []
): ShapeElement {
  return { kind: 'element', tag, ns: 'html', attrs, children };
}

const text = (value: string): TemplateShapeNode => ({
  kind: 'text',
  text: value,
  dynamic: false,
});
const dynamic: TemplateShapeNode = { kind: 'text', text: '', dynamic: true };

describe('isPlainTemplate', () => {
  it('never accepts a template the HTML parser restructures', () => {
    const next = random(20241014);
    let accepted = 0;
    const cases = 4000;
    for (let index = 0; index < cases; index += 1) {
      const roots = randomRoots(next);
      if (!isPlainTemplate(roots)) continue;
      accepted += 1;
      if (!parserKeepsStructure(roots)) {
        throw new Error(
          `accepted a restructured template: ${roots
            .map((node) => templateNodeHtml(node, null))
            .join('')}`
        );
      }
    }
    // The random trees lean on hostile markup; the check still has to
    // recognise a useful share of them.
    expect(accepted).toBeGreaterThan(cases / 20);
  });

  it('recognises everyday component markup', () => {
    expect(
      isPlainTemplate([
        element('div', [
          element('h1', [dynamic]),
          // The block compiler separates adjacent text nodes with a comment.
          element('p', [
            text('Count: '),
            { kind: 'comment', data: '' },
            dynamic,
            element('strong', [text('!')]),
          ]),
          element('ul', [
            element('li', [element('a', [text('one')], [['href', '/1']])]),
            { kind: 'comment', data: '' },
            element('li', [element('x-badge', [dynamic])]),
          ]),
          element('form', [
            element('label', [
              text('Name'),
              element('input', [], [['type', 'text']]),
            ]),
            element('button', [text('Save')], [['type', 'submit']]),
          ]),
          element(
            'img',
            [],
            [
              ['src', 'a.png'],
              ['alt', 'a > b'],
            ]
          ),
        ]),
      ])
    ).toBe(true);
  });

  it('defers to the parser for markup it moves or alters', () => {
    const restructured: TemplateShapeNode[][] = [
      [element('p', [element('div')])],
      [element('p', [element('p')])],
      [element('p', [element('span', [element('ul')])])],
      [element('li', [element('li')])],
      [element('li', [element('div', [element('li')])])],
      [element('a', [element('span', [element('a')])])],
      [element('button', [element('button')])],
      [element('form', [element('div', [element('form')])])],
      [element('h1', [element('h2')])],
      [element('table')],
      [element('select', [element('option')])],
      [element('pre', [text('\nx')])],
      [element('textarea', [text('x')])],
      [element('template', [element('div')])],
      [element('script', [text('1')])],
      [element('image')],
      [element('IMG')],
      [element('div', [], [['bad name', '1']])],
      [element('br', [text('x')])],
      [text('a'), text('b')],
      [text('')],
      [text('a\0b')],
      [{ kind: 'comment', data: 'a--b' }],
      [{ kind: 'comment', data: '>' }],
      [{ kind: 'element', tag: 'circle', ns: 'svg', attrs: [], children: [] }],
    ];
    for (const roots of restructured) {
      expect(isPlainTemplate(roots)).toBe(false);
    }
    // Shapes that only look suspicious stay plain.
    expect(
      isPlainTemplate([
        element('ul', [element('li', [element('ul', [element('li')])])]),
      ])
    ).toBe(true);
    expect(isPlainTemplate([element('li')])).toBe(true);
    expect(
      isPlainTemplate([element('div', [element('p'), element('p')])])
    ).toBe(true);
    expect(isPlainTemplate([element('a'), element('a')])).toBe(true);
    expect(isPlainTemplate([element('h1'), element('h2')])).toBe(true);
    expect(
      isPlainTemplate([element('p', [element('button', [text('x')])])])
    ).toBe(true);
  });
});
