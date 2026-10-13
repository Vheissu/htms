import {
  expressionReferences,
  scopeExpression,
  scopeStatements,
} from '../../src/component/scope';
import { click, mountComponent, query } from './test-utils';

describe('scopeExpression', () => {
  const fields = new Set(['count', 'items', 'user', 'format']);

  it('prefixes free field references with this', () => {
    expect(scopeExpression('count + 1', fields)).toBe('this.count + 1');
    expect(scopeExpression('items.length > 0', fields)).toBe(
      'this.items.length > 0'
    );
    expect(scopeExpression('format(user.name)', fields)).toBe(
      'this.format(this.user.name)'
    );
  });

  it('leaves member properties, keys, globals and this paths alone', () => {
    expect(scopeExpression('other.count', fields)).toBe('other.count');
    expect(scopeExpression('this.count', fields)).toBe('this.count');
    expect(scopeExpression('Math.max(count, 1)', fields)).toBe(
      'Math.max(this.count, 1)'
    );
    expect(scopeExpression('({ count: 1 })', fields)).toBe('({ count: 1 })');
  });

  it('expands shorthand properties', () => {
    expect(scopeExpression('({ count })', fields)).toBe(
      '({ count: this.count })'
    );
  });

  it('respects locals and names declared in the snippet', () => {
    expect(scopeExpression('count + item', fields, ['count'])).toBe(
      'count + item'
    );
    expect(scopeExpression('items.filter(count => count > 1)', fields)).toBe(
      'this.items.filter(count => count > 1)'
    );
  });

  it('does not rewrite inside plain functions, where this differs', () => {
    expect(
      scopeExpression('items.map(function (x) { return count; })', fields)
    ).toBe('this.items.map(function (x) { return count; })');
  });

  it('returns unparseable input unchanged', () => {
    expect(scopeExpression('count +', fields)).toBe('count +');
  });

  it('rewrites assignments in statements', () => {
    expect(scopeStatements('count++; items.push(1);', fields)).toBe(
      'this.count++; this.items.push(1);'
    );
    expect(
      scopeStatements('const count = 1; console.log(count);', fields)
    ).toBe('const count = 1; console.log(count);');
  });

  it('reports the free identifiers an expression reads', () => {
    expect(expressionReferences('a ? b.c : d(e)')).toEqual(
      new Set(['a', 'b', 'd', 'e'])
    );
    expect(expressionReferences('color: red')).toBeNull();
  });
});

describe('component expression scoping', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves bare identifiers in conditions', async () => {
    const element = await mountComponent(`
      <var name="flag" value="true"></var>
      <if condition="flag"><p>yes</p></if><else><p>no</p></else>
    `);
    expect(query(element, 'p').textContent).toBe('yes');
  });

  it('resolves switch variables', async () => {
    const element = await mountComponent(`
      <var name="day" value="'mon'"></var>
      <switch variable="day">
        <case value="mon"><p>Monday</p></case>
        <default><p>Other</p></default>
      </switch>
    `);
    expect(query(element, 'p').textContent).toBe('Monday');
  });

  it('interpolates expressions in text and attributes', async () => {
    const element = await mountComponent(`
      <var name="count" value="2"></var>
      <var name="items" value='["a", "b", "c"]'></var>
      <p title="{count * 10}">{count * 2} of {items.length}: {items.length > 2 ? 'many' : 'few'}</p>
    `);
    const paragraph = query(element, 'p');
    expect(paragraph.textContent).toBe('4 of 3: many');
    expect(paragraph.getAttribute('title')).toBe('20');
  });

  it('leaves braces that do not read component state as text', async () => {
    const element = await mountComponent(`
      <var name="count" value="1"></var>
      <p>{ not code } {count}</p>
      <style>.a { color: red; }</style>
    `);
    expect(query(element, 'p').textContent).toBe('{ not code } 1');
    expect(query(element, 'style').textContent).toBe('.a { color: red; }');
  });

  it('uses loop variables in interpolated expressions', async () => {
    const element = await mountComponent(`
      <var name="prices" value="[1, 2]"></var>
      <var name="rate" value="10"></var>
      <ul><repeat variable="prices" item="price" index="i"><li>{i + 1}: {price * rate}</li></repeat></ul>
    `);
    expect(
      Array.from(element.shadowRoot.querySelectorAll('li')).map(
        (li) => li.textContent
      )
    ).toEqual(['1: 10', '2: 20']);
  });

  it('lets value and expr attributes reference fields', async () => {
    const element = await mountComponent(`
      <var name="step" value="5"></var>
      <var name="total" value="0" mutable="true"></var>
      <var name="label" value="''" mutable="true"></var>
      <button id="go">Go</button>
      <p id="out">{total} {label}</p>
      <event target="#go" type="click">
        <set name="total" op="+=" value="step"></set>
        <set name="label" value="done"></set>
      </event>
    `);
    await click(element, '#go');
    expect(query(element, '#out').textContent).toBe('5 done');
  });

  it('exposes $, $$ and emit helpers', async () => {
    const element = await mountComponent(`
      <var name="text" value="''" mutable="true"></var>
      <input id="name" value="Ada">
      <button id="save">Save</button>
      <p id="out">{text}</p>
      <event target="#save" type="click">
        <set name="text" expr="$('#name').value + ' ' + $$('button').length"></set>
        <call function="emit" args="'saved', text"></call>
      </event>
    `);
    const listener = jest.fn();
    element.addEventListener('saved', (event) =>
      listener((event as CustomEvent).detail)
    );
    await click(element, '#save');
    expect(query(element, '#out').textContent).toBe('Ada 1');
    expect(listener).toHaveBeenCalledWith('Ada 1');
  });
});
