import { parseHTML } from '../../src/parser';
import { click, mountComponent, query } from './test-utils';

function type(
  input: HTMLInputElement,
  value: string,
  eventType = 'input'
): void {
  input.value = value;
  input.dispatchEvent(new Event(eventType, { bubbles: true }));
}

describe('inline event attributes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  it('runs on:click statements against component state', async () => {
    const element = await mountComponent(`
      <var name="count" value="0" mutable="true"></var>
      <button on:click="count++">Clicked {count} times</button>
    `);
    await click(element, 'button');
    await click(element, 'button');
    expect(query(element, 'button').textContent).toBe('Clicked 2 times');
  });

  it('supports the @event alias and nested mutations', async () => {
    const element = await mountComponent(`
      <var name="items" value="[]" mutable="true"></var>
      <button @click="items.push(items.length)">Add</button>
      <p>{items.join(',')}</p>
    `);
    await click(element, 'button');
    await click(element, 'button');
    expect(query(element, 'p').textContent).toBe('0,1');
  });

  it('applies prevent and key modifiers', async () => {
    const element = await mountComponent(`
      <var name="submitted" value="0" mutable="true"></var>
      <var name="entered" value="0" mutable="true"></var>
      <form on:submit.prevent="submitted++"><input on:keydown.enter="entered++"></form>
      <p>{submitted}/{entered}</p>
    `);
    const submit = new Event('submit', { cancelable: true });
    query(element, 'form').dispatchEvent(submit);
    const input = query(element, 'input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await element.updateComplete;
    expect(submit.defaultPrevented).toBe(true);
    expect(query(element, 'p').textContent).toBe('1/1');
  });

  it('honours once across re-renders', async () => {
    const element = await mountComponent(`
      <var name="count" value="0" mutable="true"></var>
      <button on:click.once="count++">{count}</button>
    `);
    await click(element, 'button');
    await click(element, 'button');
    expect(query(element, 'button').textContent).toBe('1');
  });

  it('debounces with a custom delay', async () => {
    jest.useFakeTimers();
    const element = await mountComponent(`
      <var name="query" value="''" mutable="true"></var>
      <input on:input.debounce-100="query = event.currentTarget.value">
      <p>{query}</p>
    `);
    const input = query<HTMLInputElement>(element, 'input');
    type(input, 'a');
    type(input, 'ab');
    jest.advanceTimersByTime(150);
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('ab');
  });

  it('exposes loop variables to handlers', async () => {
    const element = await mountComponent(`
      <var name="todos" value='["a", "b", "c"]' mutable="true"></var>
      <ul>
        <repeat variable="todos" item="todo" index="i">
          <li><button on:click="todos.splice(i, 1)">{todo}</button></li>
        </repeat>
      </ul>
    `);
    element.shadowRoot.querySelectorAll('button')[1].click();
    await element.updateComplete;
    expect(
      Array.from(element.shadowRoot.querySelectorAll('button')).map(
        (button) => button.textContent
      )
    ).toEqual(['a', 'c']);
  });

  it('reports unknown modifiers as errors', () => {
    const result = parseHTML(`
      <component name="bad-modifier">
        <button on:click.sometimes="x()">Go</button>
      </component>
    `);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('.sometimes');
  });
});

describe('inline bindings', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('two-way binds text inputs', async () => {
    const element = await mountComponent(`
      <var name="name" value="'Ada'" mutable="true"></var>
      <input bind:value="name">
      <button on:click="name = ''">Clear</button>
      <p>Hello {name}</p>
    `);
    const input = query<HTMLInputElement>(element, 'input');
    expect(input.value).toBe('Ada');
    type(input, 'Lin');
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('Hello Lin');

    input.focus();
    await click(element, 'button');
    expect(input.value).toBe('');
  });

  it('coerces number inputs and binds checkboxes', async () => {
    const element = await mountComponent(`
      <var name="qty" value="1" mutable="true"></var>
      <var name="gift" value="false" mutable="true"></var>
      <input type="number" bind:value="qty">
      <input type="checkbox" bind:checked="gift">
      <p>{typeof qty} {qty * 2} {gift}</p>
    `);
    type(query<HTMLInputElement>(element, 'input[type=number]'), '4');
    const checkbox = query<HTMLInputElement>(element, 'input[type=checkbox]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('number 8 true');
  });

  it('binds select values after options exist', async () => {
    const element = await mountComponent(`
      <var name="size" value="'m'" mutable="true"></var>
      <select bind:value="size"><option value="s">S</option><option value="m">M</option></select>
      <p>{size}</p>
    `);
    const select = query<HTMLSelectElement>(element, 'select');
    expect(select.value).toBe('m');
    select.value = 's';
    select.dispatchEvent(new Event('change'));
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('s');
  });

  it('binds loop item fields', async () => {
    const element = await mountComponent(`
      <var name="todos" value='[{"text": "a", "done": false}]' mutable="true"></var>
      <repeat variable="todos" item="todo">
        <input type="checkbox" bind:checked="todo.done">
      </repeat>
      <p>{todos[0].done}</p>
    `);
    const checkbox = query<HTMLInputElement>(element, 'input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('true');
  });

  it('toggles classes and styles', async () => {
    const element = await mountComponent(`
      <var name="active" value="true" mutable="true"></var>
      <var name="pct" value="40"></var>
      <div class="bar" class:active="active" style:width="pct + '%'"></div>
      <button on:click="active = !active">Toggle</button>
    `);
    const bar = query(element, '.bar');
    expect(bar.className).toBe('bar active');
    expect(bar.style.width).toBe('40%');
    await click(element, 'button');
    expect(bar.className).toBe('bar');
  });

  it('renders elements conditionally with if', async () => {
    const element = await mountComponent(`
      <var name="error" value="''" mutable="true"></var>
      <p class="error" if="error">{error}</p>
      <button on:click="error = 'Oops'">Fail</button>
    `);
    expect(element.shadowRoot.querySelector('.error')).toBeNull();
    await click(element, 'button');
    expect(query(element, '.error').textContent).toBe('Oops');
  });
});

describe('component methods', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('compiles <function> to a method that reads fields', async () => {
    const element = await mountComponent(`
      <var name="todos" value="[]" mutable="true"></var>
      <var name="draft" value="''" mutable="true"></var>
      <function name="add">
        if (!draft.trim()) return;
        todos.push(draft.trim());
        draft = '';
      </function>
      <input bind:value="draft" on:keydown.enter="add()">
      <button on:click="add()">Add</button>
      <ul><repeat variable="todos" item="todo"><li>{todo}</li></repeat></ul>
    `);
    const input = query<HTMLInputElement>(element, 'input');
    type(input, '  Write docs ');
    await click(element, 'button');
    expect(query(element, 'li').textContent).toBe('Write docs');
    expect(input.value).toBe('');
    expect(typeof element.add).toBe('function');
  });

  it('accepts params and child directive tags', async () => {
    const element = await mountComponent(`
      <var name="total" value="0" mutable="true"></var>
      <function name="addTo" params="amount">
        <set name="total" op="+=" expr="amount"></set>
      </function>
      <button on:click="addTo(5)">+5</button>
      <p>{total}</p>
    `);
    await click(element, 'button');
    expect(query(element, 'p').textContent).toBe('5');
  });

  it('is callable from <call> and interpolations', async () => {
    const element = await mountComponent(`
      <var name="price" value="12.5"></var>
      <function name="money" params="value">return '$' + value.toFixed(2);</function>
      <p>{money(price)}</p>
    `);
    expect(query(element, 'p').textContent).toBe('$12.50');
  });

  it('rejects method names that clash with element properties', () => {
    const result = parseHTML(`
      <component name="clash-box"><function name="click">return 1;</function></component>
    `);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('click');
  });
});
