import { parseHTML } from '../../src/parser';

interface HtmsTestWindow extends Window {
  __htms?: {
    effects: unknown[];
  };
  __effectRuns?: number;
  __effectCleanupCount?: number;
}

describe('Component compiler', () => {
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
    const testWindow = window as HtmsTestWindow;
    delete testWindow.__htms;
    delete testWindow.__effectRuns;
    delete testWindow.__effectCleanupCount;
  });

  const flushRuntime = async (): Promise<void> => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('initialises state variables via __htmsInitState', () => {
    const code = compile(`
      <component name="state-box">
        <var name="count" value="0" mutable="true"></var>
        <bind selector="#out" prop="textContent" expr="String(this.count)"></bind>
        <div id="out"></div>
      </component>
    `);
    expect(code).toContain("this.__htmsInitState(['count'], () => 0);");
  });

  it('generates event handlers that re-render when state changes', () => {
    const code = compile(`
      <component name="event-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="inc">Inc</button>
        <event target="#inc" type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);
    expect(code).toContain("this.__htmsSetState(['count'], '++'");
    expect(code).toContain('this.requestUpdate();');
  });

  it('emits push and splice helpers', () => {
    const code = compile(`
      <component name="list-box">
        <var name="items" value="[]" mutable="true"></var>
        <button id="add">Add</button>
        <event target="#add" type="click">
          <push array="items" value="next"></push>
          <splice array="items" index="0" delete="1" values='["first"]'></splice>
        </event>
      </component>
    `);
    expect(code).toContain("this.__htmsPushState(['items']");
    expect(code).toContain("this.__htmsSpliceState(['items']");
  });

  it('renders repeat loops inside render()', () => {
    const code = compile(`
      <component name="loop-box">
        <var name="items" value='["One","Two"]' mutable="true"></var>
        <repeat variable="items" index="i">
          <div class="item">{item}</div>
        </repeat>
      </component>
    `);
    expect(code).toContain('Array.isArray');
    expect(code).toContain('const _source');
    expect(code).toContain('= this.items;');
    expect(code).toContain('for (let i = 0; i < _items');
    expect(code).toContain('const _frag');

    execute(code);

    const element = document.createElement('loop-box') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    document.body.appendChild(element);

    const rows = Array.from(element.shadowRoot.querySelectorAll('.item')).map(
      (node) => node.textContent
    );
    expect(rows).toEqual(['One', 'Two']);
  });

  it('interpolates component state and props in template nodes', async () => {
    const code = compile(`
      <component name="template-state-box" props="labelText">
        <var name="count" value="1" mutable="true"></var>
        <button id="increment" data-label="{labelText}" title="Count {count}">{labelText}: {count}</button>
        <event target="#increment" type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);

    execute(code);

    const element = document.createElement(
      'template-state-box'
    ) as HTMLElement & {
      labelText: string;
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    element.labelText = 'Clicks';
    document.body.appendChild(element);

    const getButton = (): HTMLButtonElement => {
      const button = element.shadowRoot.querySelector('#increment');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('button missing');
      }
      return button;
    };

    expect(getButton().textContent).toBe('Clicks: 1');
    expect(getButton().getAttribute('data-label')).toBe('Clicks');
    expect(getButton().getAttribute('title')).toBe('Count 1');

    const originalButton = getButton();
    getButton().dispatchEvent(new window.Event('click', { bubbles: true }));
    await element.updateComplete;

    expect(getButton()).toBe(originalButton);
    expect(getButton().textContent).toBe('Clicks: 2');
    expect(getButton().getAttribute('title')).toBe('Count 2');

    element.labelText = 'Taps';
    await element.updateComplete;

    expect(getButton().textContent).toBe('Taps: 2');
    expect(getButton().getAttribute('data-label')).toBe('Taps');
  });

  it('preserves ordinary custom element identity across updates', async () => {
    const code = compile(`
      <component name="identity-box" props="label">
        <stable-child id="child"><span>{label}</span></stable-child>
      </component>
    `);
    execute(code);

    const element = document.createElement('identity-box') as HTMLElement & {
      label: string;
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    element.label = 'First';
    document.body.appendChild(element);
    const originalChild = element.shadowRoot.querySelector('#child');

    element.label = 'Second';
    await element.updateComplete;

    expect(element.shadowRoot.querySelector('#child')).toBe(originalChild);
    expect(originalChild?.textContent).toBe('Second');
  });

  it('recomputes derived state before rendering templates and bindings', async () => {
    const code = compile(`
      <component name="derive-box" props="labelText">
        <var name="items" value='["One"]' mutable="true"></var>
        <derive name="count" expr="this.items.length"></derive>
        <derive name="caption" expr="this.labelText + ': ' + this.count"></derive>
        <p id="summary" title="Count {count}">{caption}</p>
        <button id="add">Add</button>
        <event target="#add" type="click">
          <push array="items" expr="'Two'"></push>
        </event>
      </component>
    `);

    expect(code).toContain("this.__htmsResolvePath(['count'])");
    expect(code).toContain(
      'resolved.target[resolved.key] = this.items.length;'
    );

    execute(code);

    const element = document.createElement('derive-box') as HTMLElement & {
      labelText: string;
      count: number;
      caption: string;
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    element.labelText = 'Items';
    document.body.appendChild(element);

    const getSummary = (): HTMLParagraphElement => {
      const summary = element.shadowRoot.querySelector('#summary');
      if (!(summary instanceof HTMLParagraphElement)) {
        throw new Error('summary missing');
      }
      return summary;
    };

    expect(element.count).toBe(1);
    expect(element.caption).toBe('Items: 1');
    expect(getSummary().textContent).toBe('Items: 1');
    expect(getSummary().getAttribute('title')).toBe('Count 1');

    element.shadowRoot
      .querySelector('#add')
      ?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await element.updateComplete;

    expect(element.count).toBe(2);
    expect(element.caption).toBe('Items: 2');
    expect(getSummary().textContent).toBe('Items: 2');
    expect(getSummary().getAttribute('title')).toBe('Count 2');

    element.labelText = 'Todos';
    await element.updateComplete;

    expect(element.count).toBe(2);
    expect(element.caption).toBe('Todos: 2');
    expect(getSummary().textContent).toBe('Todos: 2');
  });

  it('preserves focus, selection, and uncontrolled input state across updates', async () => {
    const code = compile(`
      <component name="focus-box">
        <var name="count" value="0" mutable="true"></var>
        <input id="draft" value="">
        <button id="increment">Increment</button>
        <span id="count"></span>
        <bind selector="#count" prop="textContent" expr="String(this.count)"></bind>
        <event target="#increment" type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);

    execute(code);

    const element = document.createElement('focus-box') as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    document.body.appendChild(element);

    const originalInput = element.shadowRoot.querySelector(
      '#draft'
    ) as HTMLInputElement;
    originalInput.value = 'unfinished draft';
    originalInput.focus();
    originalInput.setSelectionRange(3, 8);

    const button = element.shadowRoot.querySelector(
      '#increment'
    ) as HTMLButtonElement;
    button.dispatchEvent(new window.Event('click', { bubbles: true }));
    await element.updateComplete;

    const updatedInput = element.shadowRoot.querySelector(
      '#draft'
    ) as HTMLInputElement;
    expect(updatedInput).toBe(originalInput);
    expect(element.shadowRoot.activeElement).toBe(updatedInput);
    expect(updatedInput.value).toBe('unfinished draft');
    expect(updatedInput.selectionStart).toBe(3);
    expect(updatedInput.selectionEnd).toBe(8);
    expect(element.shadowRoot.querySelector('#count')?.textContent).toBe('1');
  });

  it('reports render failures through a composed component error event', () => {
    const code = compile(`
      <component name="render-error-box">
        <derive name="broken" expr="this.missing.value"></derive>
        <p>{broken}</p>
      </component>
    `);

    execute(code);

    const element = document.createElement(
      'render-error-box'
    ) as HTMLElement & {
      renderError: unknown;
    };
    let receivedError: unknown = null;
    element.addEventListener('htms-error', (event) => {
      event.preventDefault();
      receivedError = (event as CustomEvent<{ error: unknown }>).detail.error;
    });

    expect(() => document.body.appendChild(element)).not.toThrow();
    expect(receivedError).toBeInstanceOf(Error);
    expect(element.renderError).toBe(receivedError);
  });

  it('composes custom elements with named and default slots', () => {
    const code = compile(`
      <component name="slot-panel">
        <header><slot name="heading"></slot></header>
        <main><slot><p class="fallback">Nothing here</p></slot></main>
      </component>
      <component name="composed-page">
        <slot-panel id="panel">
          <h2 slot="heading">Dashboard</h2>
          <p class="body">Composed content</p>
        </slot-panel>
      </component>
    `);

    execute(code);

    const page = document.createElement('composed-page') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    document.body.appendChild(page);

    const panel = page.shadowRoot.querySelector('#panel') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    expect(panel).toBeInstanceOf(HTMLElement);
    expect(panel.querySelector('[slot="heading"]')?.textContent).toBe(
      'Dashboard'
    );
    expect(panel.querySelector('.body')?.textContent).toBe('Composed content');
    expect(
      panel.shadowRoot.querySelector('slot[name="heading"]')
    ).not.toBeNull();
    expect(panel.shadowRoot.querySelector('slot:not([name])')).not.toBeNull();
  });

  it('creates dynamic SVG content in the SVG namespace', () => {
    const code = compile(`
      <component name="status-icon" props="colour">
        <svg viewBox="0 0 10 10" aria-label="Status {colour}">
          <circle cx="5" cy="5" r="4" fill="{colour}"></circle>
        </svg>
      </component>
    `);

    expect(code).toContain(
      "document.createElementNS('http://www.w3.org/2000/svg'"
    );
    execute(code);

    const icon = document.createElement('status-icon') as HTMLElement & {
      colour: string;
      shadowRoot: ShadowRoot;
    };
    icon.colour = 'rebeccapurple';
    document.body.appendChild(icon);

    const svg = icon.shadowRoot.querySelector('svg');
    const circle = icon.shadowRoot.querySelector('circle');
    expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(circle?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(circle?.getAttribute('fill')).toBe('rebeccapurple');
    expect(svg?.getAttribute('aria-label')).toBe('Status rebeccapurple');
  });

  it('removes unsafe nested template attributes outside strict mode', () => {
    const result = parseHTML(
      `
        <component name="safe-template">
          <section><button onfocus="steal()">Safe label</button></section>
        </component>
      `,
      { mode: 'component' }
    );

    expect(result.success).toBe(true);
    expect(
      result.warnings.some((warning) => /onfocus/.test(warning.message))
    ).toBe(true);
    expect(result.code).not.toContain('onfocus');
  });

  it('rejects unsafe nested template attributes in strict mode', () => {
    const result = parseHTML(
      `
        <component name="strict-template">
          <section><iframe srcdoc="&lt;script&gt;steal()&lt;/script&gt;"></iframe></section>
        </component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => /srcdoc/.test(error.message))).toBe(
      true
    );
  });

  it('guards custom element registration when a bundle runs twice', () => {
    const code = compile(`
      <component name="idempotent-box"><p>Ready</p></component>
    `);

    expect(() => execute(code)).not.toThrow();
    expect(() => execute(code)).not.toThrow();
  });

  it('rejects duplicate component names in one source file', () => {
    const result = parseHTML(
      `
        <component name="duplicate-box"><p>First</p></component>
        <component name="duplicate-box"><p>Second</p></component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(
      result.errors.some((error) =>
        /Duplicate component name/.test(error.message)
      )
    ).toBe(true);
  });

  it('rejects component names that collapse to the same class name', () => {
    const result = parseHTML(
      `
        <component name="class-a-b"><p>First</p></component>
        <component name="class-a_b"><p>Second</p></component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(
      result.errors.some((error) => /duplicate class name/.test(error.message))
    ).toBe(true);
  });

  it('interpolates repeat item and index tokens in component templates', () => {
    const code = compile(`
      <component name="repeat-text-box" props="items">
        <repeat variable="this.items" index="i">
          <p data-id="{item.id}" aria-label="Row {i}: {item.name}">{i}: {item.name}</p>
        </repeat>
      </component>
    `);

    execute(code);

    const emptyElement = document.createElement(
      'repeat-text-box'
    ) as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    document.body.appendChild(emptyElement);
    expect(emptyElement.shadowRoot.querySelectorAll('p')).toHaveLength(0);
    document.body.innerHTML = '';

    const element = document.createElement('repeat-text-box') as HTMLElement & {
      items: Array<{ id: string; name: string }>;
      shadowRoot: ShadowRoot;
    };
    element.items = [
      { id: 'a1', name: 'Alpha' },
      { id: 'b2', name: 'Beta' },
    ];
    document.body.appendChild(element);

    const rows = Array.from(element.shadowRoot.querySelectorAll('p')).map(
      (node) => ({
        text: node.textContent,
        id: node.getAttribute('data-id'),
        label: node.getAttribute('aria-label'),
      })
    );
    expect(rows).toEqual([
      { text: '0: Alpha', id: 'a1', label: 'Row 0: Alpha' },
      { text: '1: Beta', id: 'b2', label: 'Row 1: Beta' },
    ]);
  });

  it('wires nested repeat item events inside component templates', async () => {
    const code = compile(`
      <component name="repeat-event-box">
        <var name="items" value='["Alpha","Beta"]' mutable="true"></var>
        <repeat variable="items" index="i">
          <div class="row">
            <span>{i}: {item}</span>
            <button class="remove" type="button">Remove</button>
            <event target=".remove" type="click">
              <splice array="items" index="i" delete="1"></splice>
            </event>
          </div>
        </repeat>
      </component>
    `);

    execute(code);

    const element = document.createElement(
      'repeat-event-box'
    ) as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    document.body.appendChild(element);

    const getRows = (): string[] =>
      Array.from(element.shadowRoot.querySelectorAll('.row span')).map(
        (node) => node.textContent ?? ''
      );

    expect(getRows()).toEqual(['0: Alpha', '1: Beta']);

    element.shadowRoot
      .querySelector('.remove')
      ?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await element.updateComplete;

    expect(getRows()).toEqual(['0: Beta']);
  });

  it('renders component-scoped keyed lists with item events', async () => {
    const code = compile(`
      <component name="keyed-box">
        <var name="items" value='["Alpha","Beta"]' mutable="true"></var>
        <ul id="items"></ul>
        <keyedlist target="#items" of="items" item="item" index="i" key="item">
          <li class="row" data-name="{item}">
            <span>{i}: {item}</span>
            <button class="remove" type="button">Remove</button>
            <event target=".remove" type="click">
              <splice array="items" index="i" delete="1"></splice>
            </event>
          </li>
        </keyedlist>
      </component>
    `);

    expect(code).toContain("componentRoot.querySelectorAll('#items')");
    expect(code).toContain("setAttribute('data-key'");
    expect(code).toContain('__htmsReconcileChildren');
    expect(code).toContain('__htmsFindMatchingNode');

    execute(code);

    const element = document.createElement('keyed-box') as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    document.body.appendChild(element);

    const getRows = (): Array<{ text: string; key: string | null }> =>
      Array.from(element.shadowRoot.querySelectorAll('li.row')).map((node) => ({
        text: node.textContent?.replace('Remove', '').trim() ?? '',
        key: node.getAttribute('data-key'),
      }));

    expect(getRows()).toEqual([
      { text: '0: Alpha', key: 'Alpha' },
      { text: '1: Beta', key: 'Beta' },
    ]);

    const betaRow = element.shadowRoot.querySelector('li.row[data-key="Beta"]');
    const betaSpan = betaRow?.querySelector('span');

    element.shadowRoot
      .querySelector('.remove')
      ?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await element.updateComplete;

    expect(getRows()).toEqual([{ text: '0: Beta', key: 'Beta' }]);
    expect(element.shadowRoot.querySelector('li.row')).toBe(betaRow);
    expect(element.shadowRoot.querySelector('li.row span')).toBe(betaSpan);
  });

  it('handles switch/case branches', () => {
    const code = compile(`
      <component name="switch-box">
        <switch variable="mode">
          <case value="on"><div class="on"></div></case>
          <default><div class="off"></div></default>
        </switch>
      </component>
    `);
    expect(code).toContain('const _switch');
    expect(code).toContain('if (_switch');
    expect(code).toContain('else {');
  });

  it('accepts switch expressions', () => {
    const code = compile(`
      <component name="switch-expr">
        <switch expr="this.mode">
          <case value="on"><div class="on"></div></case>
          <default><div class="off"></div></default>
        </switch>
      </component>
    `);
    expect(code).toContain('const _switch');
    expect(code).toContain('this.mode');
  });

  it('supports else-if chains', () => {
    const code = compile(`
      <component name="chain-box">
        <if condition="this.mode === 'a'"><div class="a"></div></if>
        <else-if condition="this.mode === 'b'"><div class="b"></div></else-if>
        <else><div class="c"></div></else>
      </component>
    `);
    expect(code).toContain("if (this.mode === 'a')");
    expect(code).toContain("if (this.mode === 'b')");
  });

  it('emits while directives with guards', () => {
    const code = compile(`
      <component name="while-box">
        <var name="count" value="0" mutable="true"></var>
        <while condition="this.count < 3" max="5">
          <div class="item"></div>
          <set name="count" op="++"></set>
        </while>
      </component>
    `);
    expect(code).toContain('while (this.count < 3)');
    expect(code).toContain('WHILE exceeded max iterations');
  });

  it('supports class directives', () => {
    const code = compile(`
      <component name="class-box">
        <div id="card"></div>
        <class selector="#card" name="active" when="this.active"></class>
      </component>
    `);
    expect(code).toContain('classList.toggle');
    expect(code).toContain('this.active');
  });

  it('supports style directives', () => {
    const code = compile(`
      <component name="style-box">
        <div id="card"></div>
        <style selector="#card" prop="background-color" value="red"></style>
      </component>
    `);
    expect(code).toContain('style.setProperty');
  });

  it('supports model bindings', () => {
    const code = compile(`
      <component name="model-box">
        <var name="name" value="''" mutable="true"></var>
        <input id="name" />
        <model selector="#name" path="name"></model>
      </component>
    `);
    expect(code).toContain("this.__htmsMarkListener(targetEl, 'input'");
    expect(code).toContain("this.__htmsSetState(['name']");
  });

  it('dispatches custom events from emit directives inside handlers', () => {
    const code = compile(`
      <component name="emit-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="inc">Inc</button>
        <event target="#inc" type="click">
          <set name="count" op="++"></set>
          <emit name="count-changed" detail="this.count"></emit>
        </event>
      </component>
    `);

    expect(code).toContain(
      "this.dispatchEvent(new CustomEvent('count-changed'"
    );
    expect(code).toContain('detail: this.count');
    expect(code).toContain('composed: true');

    execute(code);

    const element = document.createElement('emit-box') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    document.body.appendChild(element);

    let received: number | undefined;
    element.addEventListener('count-changed', (event) => {
      received = (event as CustomEvent<number>).detail;
    });

    element.shadowRoot
      .querySelector('#inc')
      ?.dispatchEvent(new window.Event('click', { bubbles: true }));

    expect(received).toBe(1);
  });

  it('rejects emit directives without an event name', () => {
    const result = parseHTML(
      `
      <component name="bad-emit-box">
        <button id="go">Go</button>
        <event target="#go" type="click">
          <emit detail="this.count"></emit>
        </event>
      </component>
    `,
      { mode: 'component' }
    );

    expect(result.success).toBe(false);
    expect(
      result.errors.some((error) =>
        /EMIT requires a name attribute/.test(error.message)
      )
    ).toBe(true);
  });

  it('reflects observed attributes into reactive component properties', async () => {
    const code = compile(`
      <component name="input-prop-box" props="labelText" observed="label-text">
        <span id="label"></span>
        <bind selector="#label" prop="textContent" expr="this.labelText"></bind>
      </component>
    `);

    expect(code).not.toContain('this as any');
    expect(code).toContain('static get observedAttributes()');
    expect(code).toContain("return ['label-text'];");
    expect(code).toContain(
      "this.__htmsDefineInputProperty('labelText', 'label-text', 'string');"
    );

    execute(code);

    const element = document.createElement('input-prop-box') as HTMLElement & {
      labelText: string;
      shadowRoot: ShadowRoot;
      updateComplete: Promise<void>;
    };
    element.setAttribute('label-text', 'Initial');
    document.body.appendChild(element);

    expect(element.shadowRoot.querySelector('#label')?.textContent).toBe(
      'Initial'
    );

    element.setAttribute('label-text', 'From attribute');
    await element.updateComplete;
    expect(element.labelText).toBe('From attribute');
    expect(element.shadowRoot.querySelector('#label')?.textContent).toBe(
      'From attribute'
    );

    element.labelText = 'From property';
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('#label')?.textContent).toBe(
      'From property'
    );
  });

  it('deserializes typed props and observes their attributes automatically', async () => {
    const code = compile(`
      <component name="typed-inputs" props="count:number, active:boolean, config:json, label:string">
        <p id="summary">{label}: {count} / {active}</p>
      </component>
    `);

    expect(code).toContain('static get observedAttributes()');
    expect(code).toMatch(
      /return\s*\[\s*'count',\s*'active',\s*'config',\s*'label'\s*\]/
    );
    execute(code);

    const element = document.createElement('typed-inputs') as HTMLElement & {
      count: number | null;
      active: boolean;
      config: { theme: string } | null;
      label: string | null;
      updateComplete: Promise<void>;
      shadowRoot: ShadowRoot;
    };
    element.setAttribute('count', '3.5');
    element.setAttribute('active', '');
    element.setAttribute('config', '{"theme":"dark"}');
    element.setAttribute('label', 'Items');
    document.body.appendChild(element);

    expect(element.count).toBe(3.5);
    expect(element.active).toBe(true);
    expect(element.config).toEqual({ theme: 'dark' });
    expect(element.shadowRoot.querySelector('#summary')?.textContent).toBe(
      'Items: 3.5 / true'
    );

    element.setAttribute('count', '4');
    element.removeAttribute('active');
    element.setAttribute('config', 'not json');
    await element.updateComplete;

    expect(element.count).toBe(4);
    expect(element.active).toBe(false);
    expect(element.config).toBeNull();
    expect(element.shadowRoot.querySelector('#summary')?.textContent).toBe(
      'Items: 4 / false'
    );
  });

  it('rejects unsupported and duplicate prop declarations', () => {
    const result = parseHTML(
      `
        <component name="bad-props" props="count:integer, label, label:number">
          <p>Invalid</p>
        </component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(
      result.errors.some((error) =>
        /unsupported type "integer"/.test(error.message)
      )
    ).toBe(true);
    expect(
      result.errors.some((error) =>
        /Duplicate component property "label"/.test(error.message)
      )
    ).toBe(true);
  });

  it('rejects props that collide with the component runtime', () => {
    const result = parseHTML(
      `
        <component name="reserved-props" props="requestUpdate:string, __htmsRoot:json">
          <p>Invalid</p>
        </component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        'Property "requestUpdate" conflicts with the component runtime',
        'Property "__htmsRoot" conflicts with the component runtime',
      ])
    );
  });

  it('rejects props that shadow native HTMLElement properties', () => {
    const result = parseHTML(
      `
        <component name="native-props" props="title:string">
          <p>Invalid</p>
        </component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toContain(
      'Property "title" conflicts with the component runtime'
    );
  });

  it('batches reactive prop and state writes into one render', async () => {
    const code = compile(`
      <component name="batched-box" props="label">
        <var name="count" value="0" mutable="true"></var>
        <p id="value">{label}: {count}</p>
      </component>
    `);

    execute(code);

    const element = document.createElement('batched-box') as HTMLElement & {
      label: string;
      count: number;
      render: () => void;
      requestUpdate: () => Promise<void>;
      updateComplete: Promise<void>;
      shadowRoot: ShadowRoot;
    };
    element.label = 'Before';
    document.body.appendChild(element);

    const render = element.render.bind(element);
    let renderCount = 0;
    element.render = (): void => {
      renderCount += 1;
      render();
    };

    element.label = 'First';
    element.label = 'Final';
    element.count = 1;
    element.count = 2;

    expect(renderCount).toBe(0);
    await element.updateComplete;

    expect(renderCount).toBe(1);
    expect(element.shadowRoot.querySelector('#value')?.textContent).toBe(
      'Final: 2'
    );
  });

  it('rejects fields declared as both props and local state', () => {
    const result = parseHTML(
      `
        <component name="conflicting-field" props="count">
          <var name="count" value="0" mutable="true"></var>
        </component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(false);
    expect(
      result.errors.some((error) =>
        /cannot be both a prop and local state/.test(error.message)
      )
    ).toBe(true);
  });

  it('creates visibility directives for toggle', () => {
    const code = compile(`
      <component name="toggle-box">
        <toggle target="#panel" condition="flag"></toggle>
        <div id="panel"></div>
      </component>
    `);
    expect(code).toContain("componentRoot.querySelectorAll('#panel')");
    expect(code).toMatch(/node\.style\.display = .*flag.*\? '' : 'none';/);
  });

  it('appends children to existing nodes', () => {
    const code = compile(`
      <component name="append-box">
        <div id="target"></div>
        <append target="#target">
          <span class="child">Hi</span>
        </append>
      </component>
    `);
    expect(code).toContain("componentRoot.querySelectorAll('#target')");
    expect(code).toContain('node.appendChild(_frag');
  });

  it('emits effect runtime registration with component ownership', () => {
    const code = compile(`
      <component name="effect-box">
        <effect deps="this.count">
          console.log(this.count);
        </effect>
      </component>
    `);
    expect(code).toContain('registerEffect({');
    expect(code).toContain('owner: owner');
    expect(code).toContain('console.log(this.count)');
  });

  it('emits one shared runtime bootstrap for multiple effects', () => {
    const code = compile(`
      <component name="runtime-box">
        <effect run="console.log('first')"></effect>
        <effect run="console.log('second')"></effect>
        <fetch url="'/api/items'" into="items"></fetch>
      </component>
    `);

    expect(code.match(/registerEffect: function/g)).toHaveLength(1);
    expect(code.match(/runtime\.registerEffect\(\{/g)).toHaveLength(3);
  });

  it('omits the shared runtime from components that do not use it', () => {
    const code = compile(`
      <component name="static-box">
        <p>Static</p>
      </component>
    `);

    expect(code).not.toContain('registerEffect: function');
  });

  it('wires fetch directives into render pipeline', () => {
    const code = compile(`
      <component name="fetch-box">
        <var name="state" value="{}" mutable="true"></var>
        <fetch url="this.getUrl()" into="state.data" error="state.error" loading="state.loading" when="this.shouldFetch"></fetch>
      </component>
    `);
    expect(code).toContain('fetch(');
    expect(code).toContain('}(this));');
    expect(code).toContain("target['state']");
    expect(code).toContain('this.render();');
  });

  it('disposes component-owned runtime effects on disconnect', async () => {
    const code = compile(`
      <component name="cleanup-box">
        <effect
          run="window.__effectRuns = (window.__effectRuns || 0) + 1"
          cleanup="window.__effectCleanupCount = (window.__effectCleanupCount || 0) + 1">
        </effect>
      </component>
    `);

    expect(code).toContain('disposeEffectsFor(this)');

    execute(code);

    const element = document.createElement('cleanup-box');
    document.body.appendChild(element);
    await flushRuntime();

    const testWindow = window as HtmsTestWindow;
    expect(testWindow.__effectRuns).toBe(1);
    expect(testWindow.__htms?.effects).toHaveLength(1);

    element.remove();

    expect(testWindow.__effectCleanupCount).toBe(1);
    expect(testWindow.__htms?.effects).toHaveLength(0);
  });

  it('rejects documents without a component root', () => {
    const result = parseHTML('<div>oops</div>', { mode: 'component' });
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Wrap markup in a <component>');
  });
});
