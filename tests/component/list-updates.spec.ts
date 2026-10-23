import { mountComponent, query } from './test-utils';

describe('incremental keyed list updates', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const source = `
    <var name="items" value="[]" mutable="true"></var>
    <var name="chosen" value="0" mutable="true"></var>
    <ul><repeat variable="items" item="row" index="i" key="row.id">
      <li class:active="row.id === chosen">{i}:{row.label}</li>
    </repeat></ul>`;

  it('reads only the old and new matching rows on repeated selections', async () => {
    const element = await mountComponent(source);
    const reads: number[] = [];
    element.items = Array.from({ length: 100 }, (_, index) => ({
      get id(): number {
        reads.push(index + 1);
        return index + 1;
      },
      label: String(index + 1),
    }));
    await element.updateComplete;
    element.chosen = 1;
    await element.updateComplete;
    const first = query(element, 'li');
    first.classList.add('external');
    reads.length = 0;
    element.chosen = 2;
    await element.updateComplete;
    expect(reads).toEqual([1, 2]);
    expect(first.classList.contains('active')).toBe(false);
    expect(first.classList.contains('external')).toBe(true);
    expect(query(element, 'li.active').textContent).toBe('1:2');
  });

  it('invalidates selection lookups after deletion, swaps and deep key changes', async () => {
    const element = await mountComponent(source);
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
      { id: 4, label: 'd' },
    ];
    element.items = items;
    await element.updateComplete;
    element.chosen = 1;
    await element.updateComplete;
    const first = query(element, 'li');
    element.items = [items[3], items[1], items[2], items[0]];
    await element.updateComplete;
    expect(query(element, 'li.active')).toBe(first);
    element.items = [items[3], items[2], items[0]];
    await element.updateComplete;
    expect(
      Array.from(element.shadowRoot.querySelectorAll('li')).map(
        (n) => n.textContent
      )
    ).toEqual(['0:d', '1:c', '2:a']);
    element.chosen = 3;
    await element.updateComplete;
    expect(query(element, 'li.active').textContent).toBe('1:c');
    items[0].id = 9;
    await element.requestUpdate();
    element.chosen = 9;
    await element.updateComplete;
    expect(query(element, 'li.active')).toBe(first);
  });

  it('selects every matching row when keys are duplicated', async () => {
    const element = await mountComponent(source);
    element.items = [
      { id: 1, label: 'a' },
      { id: 1, label: 'b' },
      { id: 2, label: 'c' },
    ];
    await element.updateComplete;
    element.chosen = 1;
    await element.updateComplete;
    expect(element.shadowRoot.querySelectorAll('li.active')).toHaveLength(2);
    element.chosen = 2;
    await element.updateComplete;
    expect(element.shadowRoot.querySelectorAll('li.active')).toHaveLength(1);
    expect(query(element, 'li.active').textContent).toBe('2:c');
  });

  it('keeps other component-dependent row bindings current', async () => {
    const element = await mountComponent(
      source.replace('{i}:{row.label}', '{i}:{row.label}:{chosen}')
    );
    element.items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    await element.updateComplete;
    element.chosen = 1;
    await element.updateComplete;
    element.chosen = 2;
    await element.updateComplete;
    expect(
      Array.from(element.shadowRoot.querySelectorAll('li')).map(
        (n) => n.textContent
      )
    ).toEqual(['0:a:2', '1:b:2']);
  });

  it('retains ordinary updates for selectors read through unknown getters', async () => {
    const element = await mountComponent(`
      <var name="items" value="[]" mutable="true"></var>
      <var name="count" value="0" mutable="true"></var>
      <p>{count}</p>
      <ul><repeat variable="items" item="row" key="row.id">
        <li class:active="row.id === this.current">{row.label}</li>
      </repeat></ul>
    `);
    Object.defineProperty(element, 'current', { get: () => element.count });
    element.items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    element.count = 1;
    await element.updateComplete;
    expect(query(element, 'li.active').textContent).toBe('a');
    element.count = 2;
    await element.updateComplete;
    expect(query(element, 'li.active').textContent).toBe('b');
  });
});
