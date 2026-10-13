import { mountComponent, query } from './test-utils';

// Keeps the README examples honest.
describe('README examples', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('click counter', async () => {
    const element = await mountComponent(`
      <var name="count" value="0" mutable="true"></var>
      <button on:click="count++">Clicked {count} times</button>
    `);
    query(element, 'button').click();
    await element.updateComplete;
    expect(query(element, 'button').textContent).toBe('Clicked 1 times');
  });

  it('expressions', async () => {
    const element = await mountComponent(`
      <var name="items" value='[{"name": "Tea", "price": 3.5}]'></var>
      <var name="rate" value="2"></var>
      <p>{items.length} items, total {items.reduce((sum, item) => sum + item.price, 0) * rate}</p>
      <p if="items.length === 0">Nothing here yet.</p>
    `);
    expect(element.shadowRoot.querySelectorAll('p')).toHaveLength(1);
    expect(query(element, 'p').textContent).toBe('1 items, total 7');
  });

  it('todo list with inline bindings', async () => {
    const element = await mountComponent(`
      <var name="todos" value="[]" mutable="true"></var>
      <var name="draft" value="''" mutable="true"></var>
      <form on:submit.prevent="todos.push({ text: draft, done: false }); draft = ''">
        <input bind:value="draft" placeholder="Add a task">
      </form>
      <ul>
        <repeat variable="todos" item="todo" index="i">
          <li class:done="todo.done">
            <input type="checkbox" bind:checked="todo.done"> {todo.text}
            <button on:click="todos.splice(i, 1)">Remove</button>
          </li>
        </repeat>
      </ul>
    `);
    const input = query<HTMLInputElement>(element, 'input');
    input.value = 'Tea';
    input.dispatchEvent(new Event('input'));
    query(element, 'form').dispatchEvent(
      new Event('submit', { cancelable: true })
    );
    await element.updateComplete;
    const checkbox = query<HTMLInputElement>(element, 'li input');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await element.updateComplete;
    expect(query(element, 'li').className).toBe('done');
    expect(query(element, 'li').textContent).toContain('Tea');
    expect(input.value).toBe('');
  });

  it('getting-started name list', async () => {
    const element = await mountComponent(`
      <var name="names" value='["Ada", "Lin", "Ida"]' mutable="true"></var>
      <var name="draft" value="''" mutable="true"></var>
      <form on:submit.prevent="names.push(draft); draft = ''">
        <input bind:value="draft" placeholder="Add a name">
      </form>
      <ul>
        <repeat variable="names" index="position">
          <li>{position + 1}: {item} <button on:click="names.splice(position, 1)">Remove</button></li>
        </repeat>
      </ul>
      <p if="names.length === 0">Nobody yet.</p>
    `);
    element.shadowRoot.querySelectorAll('button')[0].click();
    await element.updateComplete;
    expect(
      Array.from(element.shadowRoot.querySelectorAll('li')).map((li) =>
        li.textContent?.replace('Remove', '').trim()
      )
    ).toEqual(['1: Lin', '2: Ida']);
  });
});
