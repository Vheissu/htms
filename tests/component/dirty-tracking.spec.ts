import { click, compileComponent, mountComponent, query } from './test-utils';

// Block components track which fields changed and update only the bindings
// that read them. These tests pin down both halves: skipped work where a
// field is unrelated, and no stale output where state is shared or changed
// in place.

interface Probe {
  calls: number;
  count(): number;
}

function texts(element: ReturnType<typeof query>, selector: string): string[] {
  return Array.from(element.querySelectorAll(selector)).map(
    (node) => node.textContent ?? ''
  );
}

describe('dirty tracking', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { __htmsBump?: unknown }).__htmsBump;
  });

  it('guards each binding with the fields it reads', () => {
    const code = compileComponent(`
      <component name="guard-box">
        <var name="count" value="0" mutable="true"></var>
        <var name="label" value="'x'" mutable="true"></var>
        <p>{count}</p><span>{label}</span>
      </component>
    `);
    expect(code).toContain('__htmsU0($$b, $$d)');
    expect(code).toContain('if ($$d & 1) {');
    expect(code).toContain('if ($$d & 2) {');
    expect(code).toContain('this.__htmsDirty |= 1;');
    expect(code).toContain('this.__htmsDirty |= 2;');
  });

  it('re-evaluates only the bindings that read a changed field', async () => {
    const probe: Probe = {
      calls: 0,
      count() {
        return ++this.calls;
      },
    };
    const element = await mountComponent(`
      <var name="probe" value="null" mutable="true"></var>
      <var name="other" value="1" mutable="true"></var>
      <p id="probe">{probe ? probe.count() : 0}</p><p id="other">{other}</p>
    `);
    element.probe = probe;
    await element.updateComplete;
    expect(query(element, '#probe').textContent).toBe('1');
    element.other = 2;
    await element.updateComplete;
    expect(query(element, '#other').textContent).toBe('2');
    expect(probe.calls).toBe(1);
    expect(query(element, '#probe').textContent).toBe('1');
  });

  it('does not render when a field nothing renders changes', async () => {
    const element = await mountComponent(`
      <var name="shown" value="1" mutable="true"></var>
      <var name="internal" value="0" mutable="true"></var>
      <button id="bump" on:click="internal++">Bump</button>
      <p>{shown}</p>
    `);
    const render = jest.spyOn(
      element as unknown as { render(): void },
      'render'
    );
    element.internal = 5;
    await element.updateComplete;
    await click(element, '#bump');
    expect(element.internal).toBe(6);
    expect(render).not.toHaveBeenCalled();
    element.shown = 2;
    await element.updateComplete;
    expect(render).toHaveBeenCalledTimes(1);
    expect(query(element, 'p').textContent).toBe('2');
  });

  it('updates a list when a row is changed through another field', async () => {
    const element = await mountComponent(`
      <var name="todos" value='[{"title": "a"}, {"title": "b"}]' mutable="true"></var>
      <var name="editing" value="null" mutable="true"></var>
      <ul><repeat variable="todos" item="todo"><li>{todo.title}</li></repeat></ul>
      <button id="pick" on:click="editing = todos[1]">Pick</button>
      <button id="rename" on:click="editing.title = 'z'">Rename</button>
    `);
    await click(element, '#pick');
    await click(element, '#rename');
    expect(texts(element.shadowRoot as never, 'li')).toEqual(['a', 'z']);
  });

  it('follows a row handed to a method parameter', async () => {
    const element = await mountComponent(`
      <var name="todos" value='[{"title": "a"}, {"title": "b"}]' mutable="true"></var>
      <var name="editing" value="null" mutable="true"></var>
      <function name="startEdit" params="todo">editing = todo;</function>
      <function name="rename" params="title">editing.title = title;</function>
      <ul><repeat variable="todos" item="todo"><li>{todo.title}</li></repeat></ul>
      <button id="pick" on:click="startEdit(todos[0])">Pick</button>
      <button id="rename" on:click="rename('z')">Rename</button>
    `);
    await click(element, '#pick');
    await click(element, '#rename');
    expect(texts(element.shadowRoot as never, 'li')).toEqual(['z', 'b']);
  });

  it('updates bindings after a method changes state in place', async () => {
    const element = await mountComponent(`
      <var name="todos" value='[{"title": "a"}, {"title": "b"}]' mutable="true"></var>
      <var name="selected" value="0" mutable="true"></var>
      <function name="shout">todos[0].title += '!';</function>
      <function name="drop" params="index">todos.splice(index, 1);</function>
      <ul><repeat variable="todos" item="todo" index="i">
        <li class:active="i === selected">{i}:{todo.title}</li>
      </repeat></ul>
      <button id="shout" on:click="shout()">Shout</button>
      <button id="drop" on:click="drop(0)">Drop</button>
      <button id="select" on:click="selected = 1">Select</button>
    `);
    await click(element, '#shout');
    expect(texts(element.shadowRoot as never, 'li')).toEqual(['0:a!', '1:b']);
    await click(element, '#select');
    expect(
      Array.from((element.shadowRoot as ShadowRoot).querySelectorAll('li')).map(
        (li) => li.classList.contains('active')
      )
    ).toEqual([false, true]);
    await click(element, '#drop');
    expect(texts(element.shadowRoot as never, 'li')).toEqual(['0:b']);
  });

  it('lets an unknown function change the state it is given', async () => {
    (window as unknown as { __htmsBump: unknown }).__htmsBump = (
      rows: Array<{ title: string }>
    ): void => {
      rows[0].title = 'bumped';
    };
    const element = await mountComponent(`
      <var name="todos" value='[{"title": "a"}]' mutable="true"></var>
      <ul><repeat variable="todos" item="todo"><li>{todo.title}</li></repeat></ul>
      <button id="bump" on:click="window.__htmsBump(todos)">Bump</button>
    `);
    await click(element, '#bump');
    expect(query(element, 'li').textContent).toBe('bumped');
  });

  it('re-tests branches only when their condition can change', async () => {
    const element = await mountComponent(`
      <var name="flag" value="true" mutable="true"></var>
      <var name="count" value="1" mutable="true"></var>
      <if condition="flag"><p id="yes">{count}</p></if>
      <else><p id="no">no</p></else>
    `);
    expect(query(element, '#yes').textContent).toBe('1');
    element.count = 2;
    await element.updateComplete;
    expect(query(element, '#yes').textContent).toBe('2');
    element.flag = false;
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('#yes')).toBeNull();
    expect(query(element, '#no').textContent).toBe('no');
    element.flag = true;
    await element.updateComplete;
    expect(query(element, '#yes').textContent).toBe('2');
  });

  it('switches cases when the subject changes', async () => {
    const element = await mountComponent(`
      <var name="day" value="'mon'" mutable="true"></var>
      <switch variable="day">
        <case value="mon"><p>Monday</p></case>
        <default><p>Other</p></default>
      </switch>
    `);
    expect(query(element, 'p').textContent).toBe('Monday');
    element.day = 'tue';
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('Other');
  });

  it('updates derived values with the fields they read', async () => {
    const element = await mountComponent(`
      <var name="count" value="2" mutable="true"></var>
      <derive name="double" expr="count * 2"></derive>
      <p>{double}</p>
    `);
    expect(query(element, 'p').textContent).toBe('4');
    element.count = 3;
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('6');
  });

  it('updates after a nested state path is set by a directive', async () => {
    const element = await mountComponent(`
      <var name="user" value='{"name": "Al"}' mutable="true"></var>
      <var name="items" value="[]" mutable="true"></var>
      <p id="name">{user.name}</p><p id="count">{items.length}</p>
      <button id="rename">Rename</button>
      <event target="#rename" type="click">
        <set name="user.name" value="Bo"></set>
        <push array="items" value="1"></push>
      </event>
    `);
    await click(element, '#rename');
    expect(query(element, '#name').textContent).toBe('Bo');
    expect(query(element, '#count').textContent).toBe('1');
  });

  it('forces every binding on requestUpdate', async () => {
    const element = await mountComponent(`
      <var name="todos" value='[{"title": "a"}]' mutable="true"></var>
      <ul><repeat variable="todos" item="todo"><li>{todo.title}</li></repeat></ul>
    `);
    (element.todos as Array<{ title: string }>)[0].title = 'changed';
    await element.updateComplete;
    expect(query(element, 'li').textContent).toBe('a');
    element.requestUpdate();
    await element.updateComplete;
    expect(query(element, 'li').textContent).toBe('changed');
  });

  it('skips rows that kept their item when a list is reordered', async () => {
    const probe = {
      calls: 0,
      label(row: { label: string }): string {
        this.calls++;
        return row.label;
      },
    };
    const source = `
      <var name="rows" value='[{"id": 1, "label": "a"}, {"id": 2, "label": "b"}, {"id": 3, "label": "c"}]' mutable="true"></var>
      <var name="selected" value="0" mutable="true"></var>
      <var name="probe" value="null" mutable="true"></var>
      <function name="swap">const row = rows[0]; rows[0] = rows[2]; rows[2] = row;</function>
      <function name="shout">rows[0].label += '!';</function>
      <ul><repeat variable="rows" item="row" key="row.id">
        <li class:active="row.id === selected">{probe ? probe.label(row) : ''}</li>
      </repeat></ul>
      <button id="swap" on:click="swap()">Swap</button>
      <button id="shout" on:click="shout()">Shout</button>
    `;
    const code = compileComponent(
      `<component name="swap-box">${source}</component>`
    );
    // Element writes report only the list's own bit: `selected` is only
    // compared, so it cannot show the change, and nothing inside a row
    // changed. Writes into a row carry the deep bit.
    expect(code).toContain('this.__htmsAfterMethod(1);');
    expect(code).toContain('this.__htmsAfterMethod(1073741825);');
    expect(code).toMatch(/__htmsList\(.*, \$\$d, 1, false\);/);

    const element = await mountComponent(source);
    element.probe = probe;
    await element.updateComplete;
    expect(probe.calls).toBe(3);
    await click(element, '#swap');
    expect(texts(element.shadowRoot as never, 'li')).toEqual(['c', 'b', 'a']);
    expect(probe.calls).toBe(3);
    await click(element, '#shout');
    expect(texts(element.shadowRoot as never, 'li')).toEqual(['c!', 'b', 'a']);
    expect(probe.calls).toBe(6);
  });

  it('treats an element write as deep when an alias is rendered', async () => {
    const code = compileComponent(`
      <component name="alias-box">
        <var name="rows" value='[{"label": "a"}, {"label": "b"}]' mutable="true"></var>
        <var name="current" value="null" mutable="true"></var>
        <function name="swap">const row = rows[0]; rows[0] = rows[1]; rows[1] = row;</function>
        <ul><repeat variable="rows" item="row"><li>{row.label}</li></repeat></ul>
        <p>{current ? current.label : ''}</p>
        <button on:click="current = rows[0]">Pick</button>
        <button on:click="swap()">Swap</button>
      </component>
    `);
    // `current` may hold a row, so the write may sit inside a rendered
    // field: both bits plus the deep bit.
    expect(code).toContain('this.__htmsAfterMethod(1073741827);');
  });

  it('updates a moved row that renders its index', async () => {
    const source = `
      <var name="rows" value='["a", "b", "c"]' mutable="true"></var>
      <function name="swap">const row = rows[0]; rows[0] = rows[2]; rows[2] = row;</function>
      <ul><repeat variable="rows" item="row" index="i" key="row"><li>{i}:{row}</li></repeat></ul>
      <button id="swap" on:click="swap()">Swap</button>
    `;
    expect(
      compileComponent(`<component name="index-box">${source}</component>`)
    ).toMatch(/__htmsList\(.*, \$\$d, 1, true\);/);
    const element = await mountComponent(source);
    await click(element, '#swap');
    expect(texts(element.shadowRoot as never, 'li')).toEqual([
      '0:c',
      '1:b',
      '2:a',
    ]);
  });

  it('gives a handler the event only when it reads it', async () => {
    const source = `
      <var name="picked" value="''" mutable="true"></var>
      <var name="count" value="0" mutable="true"></var>
      <button id="bump" on:click="count++">Bump</button>
      <button id="pick" data-id="x" on:click="picked = event.currentTarget.dataset.id">Pick</button>
      <p id="out">{count}:{picked}</p>
    `;
    const code = compileComponent(
      `<component name="event-arg-box">${source}</component>`
    );
    expect(code).toContain('__htmsH0($$b) {');
    expect(code).toContain('__htmsH1(event, $$b) {');
    const element = await mountComponent(source);
    await click(element, '#bump');
    await click(element, '#pick');
    expect(query(element, '#out').textContent).toBe('1:x');
  });

  it('gives method parameters what their call sites pass', async () => {
    const source = `
      <var name="rows" value='[{"label": "a"}]' mutable="true"></var>
      <function name="make" params="count">const data = new Array(count); data[0] = { label: 'n' }; return data;</function>
      <function name="fill">rows = make(1);</function>
      <function name="rename" params="row">row.label = 'z';</function>
      <ul><repeat variable="rows" item="row"><li>{row.label}</li></repeat></ul>
      <button id="rename" on:click="rename(rows[0])">Rename</button>
      <button id="fill" on:click="fill()">Fill</button>
    `;
    const code = compileComponent(
      `<component name="param-box">${source}</component>`
    );
    // `make` writes into an array it built from a number, so it has nothing
    // to report; `rename` writes into a row of `rows`.
    expect(code).toMatch(/make\(count\) \{\n\s+const data/);
    expect(code).toContain('this.__htmsAfterMethod(1073741825);');
    expect(code).not.toMatch(/__htmsNotifyStateChange\(-?\d+\);/);
    const element = await mountComponent(source);
    await click(element, '#rename');
    expect(query(element, 'li').textContent).toBe('z');
    await click(element, '#fill');
    expect(query(element, 'li').textContent).toBe('n');
  });

  it('creates the update promise only while a render is pending', async () => {
    const element = await mountComponent(`
      <var name="count" value="1" mutable="true"></var>
      <p>{count}</p>
    `);
    const idle = element.updateComplete;
    expect(idle).toBeInstanceOf(Promise);
    element.count = 2;
    const pending = element.updateComplete;
    expect(element.updateComplete).toBe(pending);
    await pending;
    expect(query(element, 'p').textContent).toBe('2');
    expect(element.updateComplete).not.toBe(pending);
    await element.requestUpdate();
    expect(query(element, 'p').textContent).toBe('2');
  });
});
