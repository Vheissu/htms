import { JSDOM } from 'jsdom';
import {
  parseDocument,
  SourceDocument,
  SourceElement,
  SourceNode,
  SourceParentNode,
} from '../src/source-dom';

// The compiler reads HTMS sources through the parse5-backed source tree.
// jsdom (still used for server rendering) is the reference for the DOM
// behaviour the tree reproduces: parsing, serialization, navigation,
// selectors, source locations and the mutations the compiler performs.

const MARKUP = [
  '<div class="a  b" ID="X" data-x=\'1\'>hi &amp; <b>there</b> &lt;tag&gt;</div>',
  '<table><tr><td>1</td></tr></table>',
  '<table><tbody><repeat><tr><td>x</td></tr></repeat></tbody></table>',
  '<template id="t"><tr><td>row</td></tr></template>',
  '<svg viewBox="0 0 10 10"><linearGradient id="g"/><foreignObject><div>x</div></foreignObject><a xlink:href="#g"/></svg>',
  '<math><mi>x</mi></math>',
  '<pre>\nkeep\n  this</pre><textarea>\n t</textarea>',
  '<noscript><p>ns</p></noscript>',
  '<p>a<div>b</div>c</p>',
  '<ul><li>1<li>2</ul>',
  '<!-- c --><component name="x-y"><var name="a">1</var><if condition="a"><span>y</span></if><else><i>n</i></else></component>',
  '<input value="a&quot;b" disabled><img src="x.png" alt=\'q"q\'><br>',
  '<div>  spaced   text \n new</div>',
  '<select><option selected>a<option>b</select>',
  '<form><button type=submit on:click="go()">Go</button></form>',
  '<style>.a{color:red}</style><script>var x = 1 < 2;</script>',
  '<custom-el some-attr="v"><slot name="s"></slot></custom-el>',
  '<div> &nbsp;&#169;&copy;&#x1F600;</div>',
  '<DIV CLASS="Upper"><SPAN>U</SPAN></DIV>',
  '<svg><SVG><rect/></SVG></svg>',
  '<template><template><p>nested</p></template></template>',
  '<p>unclosed <b>bold <i>both</p><p>next</p>',
  '<div xml:lang="en" xmlns:foo="bar" foo:baz="1">ns</div>',
  '<title>T</title><div>body</div>',
];

const SELECTORS = [
  '*',
  'div',
  '#X',
  '.a',
  '[data-x]',
  'div > b',
  'div b',
  'li:first-child',
  'tr td',
  'template',
  'custom-el slot',
  'input[disabled]',
];

type AnyNode = Node | SourceNode;
type AnyElement = Element | SourceElement;

function isTemplate(node: AnyElement): boolean {
  return (
    node.localName === 'template' &&
    node.namespaceURI === 'http://www.w3.org/1999/xhtml'
  );
}

// A textual dump of a tree covering the members the compiler uses.
function dump(node: AnyNode, out: string[]): void {
  if (node.nodeType === 1) {
    const element = node as AnyElement;
    const attrs = Array.from(element.attributes)
      .map((attr) => `${attr.name}=${JSON.stringify(attr.value)}`)
      .join(' ');
    out.push(
      `E ${element.tagName}|${element.localName}|${element.namespaceURI}|${attrs}|id=${element.id}|cls=${element.className}`
    );
    const content = (
      element as { content?: SourceParentNode | DocumentFragment }
    ).content;
    const children =
      isTemplate(element) && content ? content.childNodes : element.childNodes;
    for (const child of Array.from(children as ArrayLike<AnyNode>))
      dump(child, out);
    out.push(
      `/E ${element.localName} text=${JSON.stringify(element.textContent)} inner=${JSON.stringify(element.innerHTML)}`
    );
  } else if (node.nodeType === 3 || node.nodeType === 8) {
    out.push(
      `${node.nodeType === 3 ? 'T' : 'C'} ${JSON.stringify(node.nodeValue)} prev=${node.previousSibling?.nodeName} next=${node.nextSibling?.nodeName}`
    );
  } else {
    out.push(`N ${node.nodeType} ${node.nodeName}`);
  }
}

function describeSource(html: string): string[] {
  const document = parseDocument(html, { locations: true });
  const body = document.body as SourceElement;
  const out: string[] = [];
  dump(document, out);
  out.push(`OUTER ${body.outerHTML}`);
  out.push(
    `LOC ${body
      .querySelectorAll('*')
      .map(
        (element) =>
          `${element.localName}@${element.sourceCodeLocation?.startLine}:${element.sourceCodeLocation?.startCol}`
      )
      .join(',')}`
  );
  for (const selector of SELECTORS) {
    out.push(
      `SEL ${selector} ${body
        .querySelectorAll(selector)
        .map((element) => element.localName)
        .join(',')}`
    );
  }
  out.push(
    `TAGS ${document.getElementsByTagName('div').length}/${body.getElementsByTagName('*').length}`
  );
  return out;
}

function describeJsdom(html: string): string[] {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  const document = dom.window.document;
  const out: string[] = [];
  dump(document, out);
  out.push(`OUTER ${document.body.outerHTML}`);
  out.push(
    `LOC ${Array.from(document.body.querySelectorAll('*'))
      .map((element) => {
        const location = dom.nodeLocation(element);
        return `${element.localName}@${location?.startLine}:${location?.startCol}`;
      })
      .join(',')}`
  );
  for (const selector of SELECTORS) {
    out.push(
      `SEL ${selector} ${Array.from(document.body.querySelectorAll(selector))
        .map((element) => element.localName)
        .join(',')}`
    );
  }
  out.push(
    `TAGS ${document.getElementsByTagName('div').length}/${document.body.getElementsByTagName('*').length}`
  );
  return out;
}

describe('source tree', () => {
  it.each(MARKUP)('matches jsdom for %s', (html) => {
    expect(describeSource(html)).toEqual(describeJsdom(html));
  });

  describe('innerHTML parses in the element context, as jsdom does', () => {
    const source: SourceDocument = parseDocument('<body></body>');
    const dom = new JSDOM('');
    it.each([
      ['template', '<tr><td>a</td></tr><p>b</p>'],
      ['div', '<tr><td>a</td></tr><p>b</p>'],
      ['table', '<tr><td>a</td></tr>'],
      ['svg', '<rect/>'],
      ['select', '<option>a</option><div>x</div>'],
      ['p', '<div>inner</div>'],
    ])('for <%s>', (tag, markup) => {
      const sourceElement = source.createElement(tag);
      sourceElement.innerHTML = markup;
      const domElement = dom.window.document.createElement(tag);
      domElement.innerHTML = markup;
      expect(sourceElement.outerHTML).toBe(domElement.outerHTML);
      expect(sourceElement.cloneNode(true).outerHTML).toBe(
        (domElement.cloneNode(true) as Element).outerHTML
      );
      expect(sourceElement.content?.childNodes.length ?? -1).toBe(
        (domElement as HTMLTemplateElement).content?.childNodes.length ?? -1
      );
    });
  });

  it('mutates attributes and classes as jsdom does', () => {
    const source = parseDocument('<body></body>').createElement('div');
    const dom = new JSDOM('').window.document.createElement('div');
    for (const element of [source, dom]) {
      element.setAttribute('Data-Foo', 'x');
      element.classList.add('a');
      element.classList.add('b', 'a');
      element.classList.toggle('c');
      element.classList.remove('a');
      element.classList.toggle('zz', false);
      element.id = 'q';
      element.className += ' tail';
      element.removeAttribute('DATA-FOO');
      element.textContent = 'hello <&>';
    }
    expect(source.outerHTML).toBe(dom.outerHTML);
    expect(source.classList.contains('b')).toBe(dom.classList.contains('b'));

    const untouched = parseDocument('<body></body>').createElement('div');
    untouched.classList.remove('nothing');
    expect(untouched.outerHTML).toBe('<div></div>');
  });

  it('moves and replaces nodes', () => {
    const document = parseDocument(
      '<body><ul><li>a</li><li>b</li></ul></body>'
    );
    const list = document.body?.firstElementChild as SourceElement;
    const [first, second] = list.children;
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement('i'), 'text');
    list.insertBefore(fragment, second);
    expect(list.innerHTML).toBe('<li>a</li><i></i>text<li>b</li>');
    expect(fragment.childNodes).toHaveLength(0);
    first.replaceWith(document.createElement('b'), 'x');
    expect(list.innerHTML).toBe('<b></b>x<i></i>text<li>b</li>');
    expect(second.previousSibling?.nodeValue).toBe('text');
    expect(list.firstElementChild?.nextElementSibling?.localName).toBe('i');
    second.remove();
    expect(second.parentNode).toBeNull();
    expect(list.children.map((child) => child.localName)).toEqual(['b', 'i']);
    expect(list.querySelector('i')?.closest('ul')).toBe(list);
    expect(list.matches('ul')).toBe(true);
  });
});
