import { parseHTML } from '../../src/parser';
import { click, mountComponent, query } from './test-utils';

describe('component regressions', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  describe('value attributes', () => {
    it('treats a quoted value as a string literal in <set>', async () => {
      const element = await mountComponent(`
        <var name="text" value="'draft'" mutable="true"></var>
        <button id="clear">Clear</button>
        <p id="out">[{text}]</p>
        <event target="#clear" type="click">
          <set name="text" value="''"></set>
        </event>
      `);
      await click(element, '#clear');
      expect(query(element, '#out').textContent).toBe('[]');
    });

    it('concatenates strings with op="+="', async () => {
      const element = await mountComponent(`
        <var name="text" value="'a'" mutable="true"></var>
        <button id="add">Add</button>
        <p id="out">{text}</p>
        <event target="#add" type="click">
          <set name="text" op="+=" value="'b'"></set>
        </event>
      `);
      await click(element, '#add');
      expect(query(element, '#out').textContent).toBe('ab');
    });

    it('keeps numeric += for numbers and unset values', async () => {
      const element = await mountComponent(`
        <var name="total" value="1" mutable="true"></var>
        <button id="add">Add</button>
        <p id="out">{total}</p>
        <event target="#add" type="click">
          <set name="total" op="+=" value="2"></set>
        </event>
      `);
      await click(element, '#add');
      expect(query(element, '#out').textContent).toBe('3');
    });

    it('initializes object state from JSON', async () => {
      const element = await mountComponent(`
        <var name="empty" value="{}"></var>
        <var name="user" value='{"name": "Ada"}'></var>
        <p>{user.name}</p>
      `);
      expect(element.empty).toEqual({});
      expect(query(element, 'p').textContent).toBe('Ada');
    });

    it('renders missing nested paths as empty text', async () => {
      const element = await mountComponent(`
        <var name="state" value="{}"></var>
        <p>[{state.quote.text}]</p>
      `);
      expect(element.renderError).toBeNull();
      expect(query(element, 'p').textContent).toBe('[]');
    });

    it('accepts arrays of objects in <var>', async () => {
      const element = await mountComponent(`
        <var name="todos" value='[{"id": 1, "text": "Write"}, {"id": 2, "text": "Ship"}]'></var>
        <ul>
          <repeat variable="todos" item="todo"><li>{todo.text}</li></repeat>
        </ul>
      `);
      expect(
        Array.from(element.shadowRoot.querySelectorAll('li')).map(
          (li) => li.textContent
        )
      ).toEqual(['Write', 'Ship']);
    });

    it('treats setprop and style values as text, not identifiers', async () => {
      const element = await mountComponent(`
        <p id="out"></p>
        <setprop selector="#out" prop="textContent" value="Hello"></setprop>
        <style selector="#out" prop="color" value="red"></style>
      `);
      const out = query(element, '#out');
      expect(out.textContent).toBe('Hello');
      expect(out.style.color).toBe('red');
    });
  });

  describe('template output', () => {
    it('does not duplicate void elements in static templates', async () => {
      const element = await mountComponent(`<p>a<br>b</p><input id="i">`);
      expect(element.shadowRoot.querySelectorAll('br')).toHaveLength(1);
      expect(element.shadowRoot.querySelectorAll('input')).toHaveLength(1);
    });

    it('keeps CSS combinators intact inside static <style>', async () => {
      const element = await mountComponent(
        `<style>.list > li { color: red; }</style><ul class="list"><li>x</li></ul>`
      );
      expect(query(element, 'style').textContent).toBe(
        '.list > li { color: red; }'
      );
    });

    it('keeps a space between inline siblings', async () => {
      const element = await mountComponent(
        `<p><strong>Hi</strong> <em>there</em></p>`
      );
      expect(query(element, 'p').textContent).toBe('Hi there');
    });

    it('drops formatting whitespace that spans lines', async () => {
      const element = await mountComponent(`
        <ul>
          <li>a</li>
          <li>b</li>
        </ul>
      `);
      expect(query(element, 'ul').childNodes).toHaveLength(2);
    });

    it('preserves whitespace inside <pre>', async () => {
      const element = await mountComponent(`<pre>  a\n    b</pre>`);
      expect(query(element, 'pre').textContent).toBe('  a\n    b');
    });

    it('keeps SVG element name casing', () => {
      const result = parseHTML(
        `<component name="svg-case"><var name="c" value="'red'"></var><svg><defs><linearGradient id="g"><stop stop-color="{c}"></stop></linearGradient></defs></svg></component>`
      );
      expect(result.success).toBe(true);
      expect(result.code).toContain('linearGradient');
      expect(result.code).not.toContain('lineargradient');
    });

    it('keeps text directly inside <repeat>', async () => {
      const element = await mountComponent(`
        <var name="tags" value='["a", "b"]'></var>
        <p><repeat variable="tags">[{item}]</repeat></p>
      `);
      expect(query(element, 'p').textContent).toBe('[a][b]');
    });

    it('keeps relative URLs in attributes', async () => {
      const element = await mountComponent(`<a href="../about">About</a>`);
      expect(query(element, 'a').getAttribute('href')).toBe('../about');
    });
  });

  describe('events', () => {
    it('handles <submit> inside a component', async () => {
      const element = await mountComponent(`
        <var name="count" value="0" mutable="true"></var>
        <form id="form"><button>Go</button></form>
        <p id="out">{count}</p>
        <submit target="#form"><set name="count" op="++"></set></submit>
      `);
      const event = new Event('submit', { cancelable: true });
      query(element, '#form').dispatchEvent(event);
      await element.updateComplete;
      expect(event.defaultPrevented).toBe(true);
      expect(query(element, '#out').textContent).toBe('1');
    });

    it('compiles <bind> with a quoted attribute selector', async () => {
      const element = await mountComponent(`
        <p data-x="y"></p>
        <bind selector="[data-x='y']" prop="textContent" expr="'ok'"></bind>
      `);
      expect(query(element, 'p').textContent).toBe('ok');
    });

    it('does not re-arm once listeners after a re-render', async () => {
      const element = await mountComponent(`
        <var name="count" value="0" mutable="true"></var>
        <button id="once">Once</button>
        <p id="out">{count}</p>
        <event target="#once" type="click" once="true">
          <set name="count" op="++"></set>
        </event>
      `);
      await click(element, '#once');
      await click(element, '#once');
      expect(query(element, '#out').textContent).toBe('1');
    });

    it('debounces across re-renders and keeps event.currentTarget', async () => {
      jest.useFakeTimers();
      const element = await mountComponent(`
        <var name="query" value="''" mutable="true"></var>
        <var name="ticks" value="0" mutable="true"></var>
        <input id="search">
        <button id="tick">Tick</button>
        <p id="out">{query}</p>
        <event target="#search" type="input" debounce="200">
          <set name="query" expr="event.currentTarget.value"></set>
        </event>
        <event target="#tick" type="click"><set name="ticks" op="++"></set></event>
      `);
      const input = query<HTMLInputElement>(element, '#search');
      input.value = 'ab';
      input.dispatchEvent(new Event('input'));
      // An unrelated re-render must not reset the pending debounce.
      query(element, '#tick').click();
      await Promise.resolve();
      input.value = 'abc';
      input.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(250);
      await element.updateComplete;
      expect(query(element, '#out').textContent).toBe('abc');
    });
  });

  describe('reconciliation', () => {
    it('keeps attributes changed outside HTMS across re-renders', async () => {
      const element = await mountComponent(`
        <var name="count" value="0" mutable="true"></var>
        <details><summary>More</summary><p>Body</p></details>
        <button id="inc">+</button>
        <p id="out">{count}</p>
        <event target="#inc" type="click"><set name="count" op="++"></set></event>
      `);
      const details = query<HTMLDetailsElement>(element, 'details');
      details.open = true;
      details.classList.add('external');
      await click(element, '#inc');
      expect(query(element, '#out').textContent).toBe('1');
      expect(details.open).toBe(true);
      expect(details.classList.contains('external')).toBe(true);
    });

    it('still removes attributes HTMS stops rendering', async () => {
      const element = await mountComponent(`
        <var name="busy" value="true" mutable="true"></var>
        <button id="b" disabled="{busy}">Go</button>
        <button id="toggle">Toggle</button>
        <event target="#toggle" type="click"><set name="busy" value="false"></set></event>
      `);
      expect(query(element, '#b').hasAttribute('disabled')).toBe(true);
      await click(element, '#toggle');
      expect(query(element, '#b').hasAttribute('disabled')).toBe(false);
    });
  });

  describe('fetch', () => {
    it('does not let an aborted request overwrite newer state', async () => {
      const resolvers: Array<(value: Response) => void> = [];
      const originalFetch = global.fetch;
      global.fetch = jest.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            resolvers.push(resolve);
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      ) as unknown as typeof fetch;
      const consoleError = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        const element = await mountComponent(`
          <var name="page" value="1" mutable="true"></var>
          <var name="state" value="{}" mutable="true"></var>
          <button id="next">Next</button>
          <fetch url="'/items?page=' + this.page" into="state.data" loading="state.loading" error="state.error"></fetch>
          <event target="#next" type="click"><set name="page" op="++"></set></event>
        `);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(resolvers).toHaveLength(1);

        await click(element, '#next');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(resolvers).toHaveLength(2);

        const state = element.state as {
          loading?: boolean;
          error?: unknown;
        };
        expect(state.loading).toBe(true);
        expect(state.error).toBeNull();
        expect(consoleError).not.toHaveBeenCalledWith(
          'FETCH request failed:',
          expect.anything()
        );
      } finally {
        global.fetch = originalFetch;
        consoleError.mockRestore();
      }
    });
  });
});
