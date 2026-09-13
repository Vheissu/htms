import { parseHTML } from '../../src/parser';

describe('Nested directives inside markup', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  const execute = (code: string): void => {
    const runnable = code.replace(/export\s*\{[^}]*\};?/g, '');
    new Function(runnable)();
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an <event> nested inside an element', () => {
    const code = compile(`
      <component name="nested-event-box">
        <var name="count" value="0" mutable="true"></var>
        <div class="wrap">
          <button id="inc">+</button>
          <event target="#inc" type="click">
            <set name="count" op="++"></set>
          </event>
        </div>
      </component>
    `);
    expect(code).toContain("querySelectorAll('#inc')");
    expect(code).toContain("this.__htmsSetState(['count'], '++'");
  });

  it('renders an <if> nested inside an element', () => {
    const code = compile(`
      <component name="nested-if-box">
        <var name="count" value="0" mutable="true"></var>
        <div class="wrap">
          <if condition="this.count > 0"><p>positive</p></if>
        </div>
      </component>
    `);
    expect(code).toContain('if (this.count > 0)');
    expect(code).toContain('positive');
  });

  it('fires nested event listeners against the enclosing element', async () => {
    const code = compile(`
      <component name="nested-live-box">
        <var name="count" value="0" mutable="true"></var>
        <div class="wrap">
          <button id="inc">+</button>
          <event target="#inc" type="click">
            <set name="count" op="++"></set>
          </event>
          <span id="out">{count}</span>
        </div>
      </component>
    `);
    execute(code);
    const element = document.createElement('nested-live-box') as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    document.body.appendChild(element);
    await element.updateComplete;

    const button = element.shadowRoot.querySelector('#inc') as HTMLElement;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await element.updateComplete;

    const out = element.shadowRoot.querySelector('#out') as HTMLElement;
    expect(out.textContent).toBe('1');
  });

  it('supports custom event types on nested listeners', () => {
    const code = compile(`
      <component name="custom-event-box">
        <var name="seen" value="0" mutable="true"></var>
        <div class="wrap">
          <ul><li>a</li></ul>
          <event target="ul > li" type="todo-added">
            <set name="seen" op="++"></set>
          </event>
        </div>
      </component>
    `);
    expect(code).toContain("'todo-added'");
    expect(code).toContain("querySelectorAll('ul > li')");
  });

  it('applies event modifiers prevent/stop/once/passive', () => {
    const code = compile(`
      <component name="modifier-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="b">x</button>
        <event target="#b" type="click" prevent="true" stop="true" once="true" passive="false">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);
    expect(code).toContain('event.preventDefault()');
    expect(code).toContain('event.stopPropagation()');
    expect(code).toContain('once: true');
  });

  it('debounces event handlers', () => {
    const code = compile(`
      <component name="debounce-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="b">x</button>
        <event target="#b" type="click" debounce="200">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);
    expect(code).toContain('setTimeout');
    expect(code).toContain('clearTimeout');
  });
});

describe('Boolean attribute interpolation', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  const execute = (code: string): void => {
    const runnable = code.replace(/export\s*\{[^}]*\};?/g, '');
    new Function(runnable)();
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles disabled via attribute presence, not "false" string', async () => {
    const code = compile(`
      <component name="bool-box">
        <var name="flag" value="false" mutable="true"></var>
        <button id="b" disabled="{flag}">x</button>
      </component>
    `);
    expect(code).toContain("setAttribute('disabled', '')");
    expect(code).toContain("removeAttribute('disabled')");

    execute(code);
    const element = document.createElement('bool-box') as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    document.body.appendChild(element);
    await element.updateComplete;

    const button = element.shadowRoot.querySelector('#b') as HTMLElement;
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});

describe('Selector and expression safety', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  it('accepts CSS combinators in directive selectors', () => {
    const code = compile(`
      <component name="selector-box">
        <var name="count" value="0" mutable="true"></var>
        <ul><li>a</li></ul>
        <event target="ul > li + li" type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);
    expect(code).toContain("'ul > li + li'");
  });

  it('accepts attribute selectors with quotes', () => {
    const code = compile(`
      <component name="attr-selector-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="b">x</button>
        <event target='button[data-kind="primary"]' type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);
    expect(code).toContain('data-kind');
  });

  it('does not flag the once attribute as an event handler', () => {
    const result = parseHTML(
      `<component name="once-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="b">x</button>
        <event target="#b" type="click" once="true">
          <set name="count" op="++"></set>
        </event>
      </component>`,
      { mode: 'component' }
    );
    expect(result.success).toBe(true);
    expect(
      result.warnings.some((warning) =>
        /Dangerous attribute/i.test(warning.message)
      )
    ).toBe(false);
  });

  it('still rejects real inline event-handler attributes', () => {
    const result = parseHTML(
      `<component name="bad-box">
        <button id="b" onclick="alert(1)">x</button>
      </component>`,
      { mode: 'component', strictMode: true }
    );
    expect(result.success).toBe(false);
  });

  it('escapes quotes and backslashes in generated string literals', () => {
    const code = compile(`
      <component name="escape-box">
        <div title='He said "hi" \\ back'>safe</div>
      </component>
    `);
    expect(code).not.toContain('Unterminated');
    expect(code).toContain('setAttribute');
  });
});

describe('Repeat loop variable', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  it('honours a custom item attribute', () => {
    const code = compile(`
      <component name="item-var-box">
        <var name="todos" value='[]' mutable="true"></var>
        <repeat variable="this.todos" item="todo" index="i">
          <li>{todo.title}</li>
        </repeat>
      </component>
    `);
    expect(code).toContain('const todo =');
    expect(code).toContain('todo.title');
  });

  it('rejects an invalid item variable name', () => {
    const result = parseHTML(
      `<component name="bad-item-box">
        <repeat variable="this.todos" item="1bad"><li>x</li></repeat>
      </component>`,
      { mode: 'component' }
    );
    expect(result.success).toBe(false);
  });

  it('does not warn about empty loop body when template children exist', () => {
    const result = parseHTML(
      `<component name="loop-warn-box">
        <var name="todos" value='[]' mutable="true"></var>
        <repeat variable="this.todos" item="todo"><li>{todo.title}</li></repeat>
      </component>`,
      { mode: 'component' }
    );
    expect(result.success).toBe(true);
    expect(
      result.warnings.some((warning) => /Empty loop body/i.test(warning.message))
    ).toBe(false);
  });
});

describe('Deterministic output', () => {
  it('produces identical output for identical input', () => {
    const markup = `
      <component name="det-box">
        <div><effect run="this.count"></effect></div>
        <append target="#list"><li>x</li></append>
      </component>
    `;
    const first = parseHTML(markup, { mode: 'component' });
    const second = parseHTML(markup, { mode: 'component' });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.code).toBe(second.code);
  });
});

describe('Modern JavaScript syntax', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  it('passes optional chaining and nullish coalescing through codegen', () => {
    const code = compile(`
      <component name="modern-box">
        <var name="user" value="null" mutable="true"></var>
        <bind selector="#name" prop="textContent" expr="this.user?.name ?? 'anon'"></bind>
        <div id="name"></div>
      </component>
    `);
    expect(code).toContain('?.');
    expect(code).toContain('??');
  });
});

describe('Fetch url convenience', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  it('treats an unquoted url attribute as a string literal', () => {
    const code = compile(`
      <component name="fetch-box">
        <fetch url="/api/items" into="data"></fetch>
      </component>
    `);
    expect(code).toContain("fetch('/api/items'");
  });
});
