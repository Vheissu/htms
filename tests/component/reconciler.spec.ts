import { parseHTML } from '../../src/parser';
import { MountedComponent, query, runComponentCode } from './test-utils';

interface Reconciler extends MountedComponent {
  __htmsReconcileChildren(target: Node, source: Node): void;
}

let sequence = 0;

async function mount(
  body = '<p>ready</p>',
  renderer: 'legacy' | 'auto' = 'legacy'
): Promise<Reconciler> {
  const name = `reconciler-test-${++sequence}`;
  const result = parseHTML(`<component name="${name}">${body}</component>`, {
    mode: 'component',
    renderer,
  });
  if (!result.success || !result.code) {
    throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
  }
  expect(result.code).toContain('__htmsReconcileChildren');
  runComponentCode(result.code);
  const element = document.createElement(name) as Reconciler;
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

function markup(html: string): HTMLDivElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

describe('reconciling renderer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('adopts attributes once and then preserves changes outside HTMS', async () => {
    const component = await mount();
    const target = markup('<p title="server" data-server="yes"></p>');
    const paragraph = target.firstElementChild as HTMLElement;
    component.__htmsReconcileChildren(target, markup('<p></p>'));
    expect(paragraph.attributes).toHaveLength(0);

    paragraph.classList.add('external');
    component.__htmsReconcileChildren(target, markup('<p></p>'));
    expect(paragraph.className).toBe('external');
    component.__htmsReconcileChildren(
      target,
      markup('<p title="rendered"></p>')
    );
    expect(paragraph.title).toBe('rendered');
    expect(paragraph.className).toBe('external');
    component.__htmsReconcileChildren(target, markup('<p></p>'));
    expect(paragraph.hasAttribute('title')).toBe(false);
    expect(paragraph.className).toBe('external');
    component.__htmsReconcileChildren(target, markup('<p></p>'));
    expect(target.firstElementChild).toBe(paragraph);
    expect(paragraph.className).toBe('external');
  });

  it('records attribute names that overlap Object.prototype', async () => {
    const component = await mount();
    const target = markup('');
    component.__htmsReconcileChildren(
      target,
      markup('<p __proto__="safe" constructor="own" tostring="text"></p>')
    );
    const paragraph = target.firstElementChild as HTMLElement;
    expect(paragraph.getAttribute('__proto__')).toBe('safe');
    expect(paragraph.getAttribute('constructor')).toBe('own');
    component.__htmsReconcileChildren(
      target,
      markup('<p __proto__="changed" tostring="next"></p>')
    );
    expect(paragraph.getAttribute('__proto__')).toBe('changed');
    expect(paragraph.getAttribute('tostring')).toBe('next');
    expect(paragraph.hasAttribute('constructor')).toBe(false);
    component.__htmsReconcileChildren(target, markup('<p></p>'));
    expect(paragraph.attributes).toHaveLength(0);
  });

  it('retains keyed and ID matches when their positions change', async () => {
    const component = await mount();
    const target = markup('');
    component.__htmsReconcileChildren(
      target,
      markup(
        '<p id="a">A</p><p id="b">B</p><b data-key="x">X</b><b data-key="y">Y</b>'
      )
    );
    const [a, b, x, y] = Array.from(target.children);
    component.__htmsReconcileChildren(
      target,
      markup(
        '<p id="b">B!</p><b data-key="y">Y!</b><p id="a">A!</p><b data-key="x">X!</b>'
      )
    );
    expect(Array.from(target.children)).toEqual([b, y, a, x]);
    expect(target.textContent).toBe('B!Y!A!X!');
  });

  it('keeps repeated keyed siblings instead of dropping duplicate matches', async () => {
    const component = await mount();
    const target = markup('');
    component.__htmsReconcileChildren(
      target,
      markup('<p data-key="x">one</p><p data-key="x">two</p>')
    );
    const before = Array.from(target.children);
    component.__htmsReconcileChildren(
      target,
      markup('<p data-key="x">first</p><p data-key="x">second</p>')
    );
    expect(Array.from(target.children)).toEqual(before);
    expect(target.textContent).toBe('firstsecond');
  });

  it.each(['element', 'fragment'])(
    'clears and repopulates an empty %s child list',
    async (kind) => {
      const component = await mount();
      const target =
        kind === 'element' ? markup('') : document.createDocumentFragment();
      component.__htmsReconcileChildren(target, markup('<b>one</b><i>two</i>'));
      component.__htmsReconcileChildren(target, markup(''));
      expect(target.childNodes).toHaveLength(0);
      component.__htmsReconcileChildren(target, markup(''));
      component.__htmsReconcileChildren(target, markup('<b>new</b>tail'));
      expect(target.textContent).toBe('newtail');
    }
  );

  it('keeps live input properties and external attributes through updates', async () => {
    const component = await mount(`
      <var name="text" value="'draft'" mutable="true"></var>
      <var name="tick" value="0" mutable="true"></var>
      <input id="editor"><bind selector="#editor" prop="value" expr="text"></bind>
      <details><summary>More</summary><p>{tick}</p></details>
    `);
    const input = query<HTMLInputElement>(component, '#editor');
    const details = query<HTMLDetailsElement>(component, 'details');
    expect(input.value).toBe('draft');
    details.open = true;
    details.classList.add('external');
    component.text = 'updated';
    component.tick = 1;
    await component.updateComplete;
    expect(query(component, '#editor')).toBe(input);
    expect(input.value).toBe('updated');
    expect(details.open).toBe(true);
    expect(details.className).toBe('external');
  });

  it('applies the same reconciliation to automatic fallback components', async () => {
    const component = await mount(
      `
      <var name="items" value='["a", "b"]' mutable="true"></var>
      <var name="picked" value="''" mutable="true"></var>
      <ul><repeat variable="items" item="item"><li class="row">{item}</li></repeat></ul>
      <event target=".row" type="click"><set name="picked" value="'clicked'"></set></event>
      <p>{picked}</p>
    `,
      'auto'
    );
    component.items = [];
    await component.updateComplete;
    expect(component.shadowRoot.querySelectorAll('li')).toHaveLength(0);
    component.items = ['new'];
    await component.updateComplete;
    query<HTMLElement>(component, 'li').click();
    await component.updateComplete;
    expect(query(component, 'p').textContent).toBe('clicked');
    expect(query(component, 'li').textContent).toBe('new');
  });
});
