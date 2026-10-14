import { parseHTML } from '../../src/parser';
import { hydrate } from '../../src/hydration';
import { renderToString } from '../../src/server-renderer';
import {
  MountedComponent,
  click,
  compileComponent,
  mountComponent,
  query,
  runComponentCode,
} from './test-utils';

interface Row {
  id: number;
  label: string;
}

// Deterministic pseudo-random numbers for the reconciliation fuzz test.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function swap(list: Row[], a: number, b: number): void {
  const first = list.at(a) as Row;
  list.splice(a, 1, list.at(b) as Row);
  list.splice(b, 1, first);
}

function rows(element: MountedComponent): HTMLElement[] {
  return Array.from(element.shadowRoot.querySelectorAll('li'));
}

describe('block renderer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('keyed lists', () => {
    const source = `
      <var name="items" value="[]" mutable="true"></var>
      <ul>
        <repeat variable="items" item="row" index="i" key="row.id">
          <li>{i}:{row.label}</li>
        </repeat>
      </ul>
    `;

    it('compiles to a block and reuses rows by key', async () => {
      expect(
        compileComponent(`<component name="keyed-shape">${source}</component>`)
      ).toContain('__htmsList(');
      const element = await mountComponent(source);
      element.items = [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
        { id: 3, label: 'c' },
      ];
      await element.updateComplete;
      const [first, second, third] = rows(element);
      expect(rows(element).map((row) => row.textContent)).toEqual([
        '0:a',
        '1:b',
        '2:c',
      ]);

      element.items = [
        { id: 3, label: 'c' },
        { id: 1, label: 'a!' },
        { id: 2, label: 'b' },
      ];
      await element.updateComplete;
      expect(rows(element)).toEqual([third, first, second]);
      expect(rows(element).map((row) => row.textContent)).toEqual([
        '0:c',
        '1:a!',
        '2:b',
      ]);
    });

    // The second layout shares its parent with other content, so rows are
    // placed relative to an anchor instead of owning the <ul>.
    it.each([
      ['owning its parent', source, 42],
      [
        'between siblings',
        `
      <var name="items" value="[]" mutable="true"></var>
      <ul>
        <li>head</li>
        <repeat variable="items" item="row" index="i" key="row.id">
          <li>{i}:{row.label}</li>
        </repeat>
        <li>tail</li>
      </ul>
    `,
        7,
      ],
    ])(
      'matches the data after random inserts, removals and moves (%s)',
      async (_, layout, seed) => {
        const element = await mountComponent(layout);
        const next = random(seed);
        let nextId = 1;
        let data: Row[] = [];
        const nodes = new Map<number, HTMLElement>();

        for (let step = 0; step < 150; step += 1) {
          const copy = data.slice();
          const operation = Math.floor(next() * 6);
          if (operation === 0 || copy.length === 0) {
            const count = 1 + Math.floor(next() * 8);
            const at = Math.floor(next() * (copy.length + 1));
            const added = Array.from({ length: count }, () => ({
              id: nextId,
              label: `r${nextId++}`,
            }));
            copy.splice(at, 0, ...added);
          } else if (operation === 1) {
            copy.splice(
              Math.floor(next() * copy.length),
              1 + Math.floor(next() * 4)
            );
          } else if (operation === 2) {
            for (let i = copy.length - 1; i > 0; i -= 1) {
              swap(copy, i, Math.floor(next() * (i + 1)));
            }
          } else if (operation === 3) {
            copy.reverse();
          } else if (operation === 4 && copy.length > 1) {
            swap(
              copy,
              Math.floor(next() * copy.length),
              Math.floor(next() * copy.length)
            );
          } else {
            copy.length = Math.floor(next() * copy.length);
          }
          data = copy;
          element.items = data;
          await element.updateComplete;

          const all = rows(element);
          const rendered = all.filter(
            (row) => row.textContent !== 'head' && row.textContent !== 'tail'
          );
          if (all.length !== rendered.length) {
            expect(all[0].textContent).toBe('head');
            expect(all[all.length - 1].textContent).toBe('tail');
          }
          expect(rendered.map((row) => row.textContent)).toEqual(
            data.map((row, index) => `${index}:${row.label}`)
          );
          // A row that stayed in the list kept its element.
          rendered.forEach((node, index) => {
            const previous = nodes.get((data.at(index) as Row).id);
            if (previous) {
              expect(node).toBe(previous);
            }
          });
          nodes.clear();
          rendered.forEach((node, index) =>
            nodes.set((data.at(index) as Row).id, node)
          );
        }
      }
    );

    it('renders every row when keys repeat', async () => {
      const element = await mountComponent(source);
      element.items = [
        { id: 1, label: 'a' },
        { id: 1, label: 'b' },
      ];
      await element.updateComplete;
      element.items = [
        { id: 1, label: 'c' },
        { id: 2, label: 'd' },
        { id: 1, label: 'e' },
      ];
      await element.updateComplete;
      expect(rows(element).map((row) => row.textContent)).toEqual([
        '0:c',
        '1:d',
        '2:e',
      ]);
    });

    it('moves multi-node rows as a unit', async () => {
      const element = await mountComponent(`
        <var name="items" value='["a", "b", "c"]' mutable="true"></var>
        <div id="out"><repeat variable="items" item="name" key="name">[<b>{name}</b><i if="name === 'b'">!</i>]</repeat><hr></div>
      `);
      expect(query(element, '#out').textContent).toBe('[a][b!][c]');
      element.items = ['c', 'b', 'a'];
      await element.updateComplete;
      expect(query(element, '#out').textContent).toBe('[c][b!][a]');
      element.items = ['b'];
      await element.updateComplete;
      expect(query(element, '#out').innerHTML).toContain('<hr>');
      expect(query(element, '#out').textContent).toBe('[b!]');
    });
  });

  it('updates unkeyed lists by position', async () => {
    const element = await mountComponent(`
      <var name="items" value='["a", "b"]' mutable="true"></var>
      <ul><repeat variable="items" item="name"><li>{name}</li></repeat></ul>
    `);
    const [first] = rows(element);
    element.items = ['x', 'y', 'z'];
    await element.updateComplete;
    expect(rows(element).map((row) => row.textContent)).toEqual([
      'x',
      'y',
      'z',
    ]);
    expect(rows(element)[0]).toBe(first);
    element.items = [];
    await element.updateComplete;
    expect(rows(element)).toHaveLength(0);
  });

  it('gives nested loops access to outer items in text and handlers', async () => {
    const element = await mountComponent(`
      <var name="groups" value='[{ "name": "g1", "items": ["a", "b"] }, { "name": "g2", "items": ["c"] }]' mutable="true"></var>
      <var name="picked" value="''" mutable="true"></var>
      <repeat variable="groups" item="group" index="g">
        <section>
          <repeat variable="group.items" item="entry" index="e">
            <button class="pick" on:click="picked = group.name + '/' + entry + '/' + g + e">{group.name}:{entry}</button>
          </repeat>
        </section>
      </repeat>
      <p>{picked}</p>
    `);
    const buttons = Array.from(
      element.shadowRoot.querySelectorAll<HTMLButtonElement>('.pick')
    );
    expect(buttons.map((button) => button.textContent)).toEqual([
      'g1:a',
      'g1:b',
      'g2:c',
    ]);
    buttons[1].click();
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('g1/b/01');

    element.groups = [{ name: 'g3', items: ['z'] }];
    await element.updateComplete;
    query(element, '.pick').click();
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('g3/z/00');
  });

  it('switches branches inside rows and rows inside branches', async () => {
    const element = await mountComponent(`
      <var name="show" value="true" mutable="true"></var>
      <var name="items" value="[1, 2, 3, 4]" mutable="true"></var>
      <if condition="show">
        <ul>
          <repeat variable="items" item="n">
            <li>
              <switch expr="n % 3">
                <case value="0"><b>fizz</b></case>
                <case value="1"><i>one</i></case>
                <default><u>{n}</u></default>
              </switch>
            </li>
          </repeat>
        </ul>
      </if>
      <else><p>hidden</p></else>
    `);
    expect(rows(element).map((row) => row.textContent?.trim())).toEqual([
      'one',
      '2',
      'fizz',
      'one',
    ]);
    element.items = [3, 5];
    await element.updateComplete;
    expect(rows(element).map((row) => row.textContent?.trim())).toEqual([
      'fizz',
      '5',
    ]);
    element.show = false;
    await element.updateComplete;
    expect(rows(element)).toHaveLength(0);
    expect(query(element, 'p').textContent).toBe('hidden');
  });

  it('keeps class toggles when a dynamic class attribute changes', async () => {
    const element = await mountComponent(`
      <var name="tone" value="'info'" mutable="true"></var>
      <var name="active" value="true" mutable="true"></var>
      <div id="box" class="box {tone}" class:active="active"></div>
    `);
    const box = query(element, '#box');
    expect(box.className).toBe('box info active');
    element.tone = 'warn';
    await element.updateComplete;
    expect(box.className).toBe('box warn active');
    element.active = false;
    await element.updateComplete;
    expect(box.className).toBe('box warn');
  });

  it('leaves DOM untouched when values are unchanged', async () => {
    const element = await mountComponent(`
      <var name="label" value="'a'" mutable="true"></var>
      <var name="other" value="0" mutable="true"></var>
      <p title="{label}">{label}</p>
    `);
    const paragraph = query(element, 'p');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(element.shadowRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    element.other = 1;
    await element.updateComplete;
    records.push(...observer.takeRecords());
    expect(records).toHaveLength(0);
    element.label = 'b';
    await element.updateComplete;
    records.push(...observer.takeRecords());
    expect(records.map((record) => record.type).sort()).toEqual([
      'attributes',
      'characterData',
    ]);
    expect(query(element, 'p')).toBe(paragraph);
    observer.disconnect();
  });

  it('renders text for numbers, empty values and objects mutated in place', async () => {
    const element = await mountComponent(`
      <var name="count" value="1" mutable="true"></var>
      <var name="missing" value="null" mutable="true"></var>
      <var name="tags" value='["a", "b"]' mutable="true"></var>
      <p id="count">{count}</p><p id="missing">{missing}</p><p id="tags">{tags}</p>
    `);
    expect(query(element, '#count').textContent).toBe('1');
    expect(query(element, '#missing').textContent).toBe('');
    expect(query(element, '#tags').textContent).toBe('a,b');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(element.shadowRoot, {
      subtree: true,
      characterData: true,
    });
    element.requestUpdate();
    await element.updateComplete;
    records.push(...observer.takeRecords());
    expect(records).toHaveLength(0);
    (element.tags as string[]).push('c');
    element.count = 2;
    element.missing = 'x';
    element.requestUpdate();
    await element.updateComplete;
    expect(query(element, '#count').textContent).toBe('2');
    expect(query(element, '#missing').textContent).toBe('x');
    expect(query(element, '#tags').textContent).toBe('a,b,c');
    observer.disconnect();
  });

  describe('delegated events', () => {
    it('stops at a handler that calls stopPropagation', async () => {
      const element = await mountComponent(`
        <var name="log" value="''" mutable="true"></var>
        <div id="outer" on:click="log += 'outer'">
          <button id="stop" on:click.stop="log += 'stop'">s</button>
          <button id="pass" on:click="log += 'pass'">p</button>
        </div>
        <p>{log}</p>
      `);
      await click(element, '#stop');
      expect(query(element, 'p').textContent).toBe('stop');
      await click(element, '#pass');
      expect(query(element, 'p').textContent).toBe('stoppassouter');
    });

    it('exposes the handler element as currentTarget', async () => {
      const element = await mountComponent(`
        <var name="seen" value="''" mutable="true"></var>
        <div id="card" data-name="card" on:click="seen = event.currentTarget.dataset.name">
          <span id="inner">inner</span>
        </div>
        <p>{seen}</p>
      `);
      await click(element, '#inner');
      expect(query(element, 'p').textContent).toBe('card');
    });

    it('runs each light-DOM component handler once', async () => {
      const tag = 'delegate-inner-box';
      runComponentCode(
        compileComponent(`
          <component name="${tag}" shadow="none">
            <var name="count" value="0" mutable="true"></var>
            <button class="inner" on:click="count++">{count}</button>
          </component>
        `)
      );
      const element = await mountComponent(
        `
        <var name="outer" value="0" mutable="true"></var>
        <div on:click="outer++"><${tag}></${tag}></div>
        <p>{outer}</p>
      `,
        'shadow="none"'
      );
      const button = element.querySelector('.inner') as HTMLButtonElement;
      button.click();
      await element.updateComplete;
      await (element.querySelector(tag) as MountedComponent).updateComplete;
      expect(button.textContent).toBe('1');
      expect(element.querySelector('p')?.textContent).toBe('1');
    });

    it('stops listening when disconnected', async () => {
      const element = await mountComponent(`
        <var name="count" value="0" mutable="true"></var>
        <button on:click="count++">{count}</button>
      `);
      const button = query(element, 'button');
      element.remove();
      button.click();
      expect(element.count).toBe(0);
    });
  });

  it('falls back to the reconciling renderer for unsupported features', () => {
    const result = parseHTML(
      `<component name="fallback-box">
        <var name="count" value="0" mutable="true"></var>
        <while condition="this.count < 2" max="5">
          <p>x</p>
          <set name="count" op="++"></set>
        </while>
      </component>`,
      { mode: 'component' }
    );
    expect(result.success).toBe(true);
    expect(result.code).toContain('__htmsReconcileChildren');
    expect(result.code).not.toContain('__htmsList(');
  });

  it('honours repeat keys in the reconciling renderer', async () => {
    const result = parseHTML(
      `<component name="legacy-keyed-box">
        <var name="items" value='[{ "id": 1 }, { "id": 2 }]' mutable="true"></var>
        <ul><repeat variable="items" item="row" key="row.id"><li>{row.id}</li></repeat></ul>
      </component>`,
      { mode: 'component', renderer: 'legacy' }
    );
    runComponentCode(result.code ?? '');
    const element = document.createElement(
      'legacy-keyed-box'
    ) as MountedComponent;
    document.body.appendChild(element);
    await element.updateComplete;
    const [first, second] = rows(element);
    element.items = [{ id: 2 }, { id: 1 }];
    await element.updateComplete;
    expect(rows(element)).toEqual([second, first]);
    expect(first.getAttribute('data-key')).toBe('1');
  });

  it('hydrates server markup with lists and branches', async () => {
    const source = `
      <component name="hydrated-list" props="items:json">
        <h2 id="title">Items</h2>
        <ul id="list"><repeat variable="items" item="row" key="row"><li>{row}</li></repeat></ul>
        <p id="more" if="(items || []).length > 2">many</p>
        <footer id="foot">{items.length}</footer>
      </component>
    `;
    const server = renderToString(source, {
      props: { items: ['a', 'b', 'c'] },
    });
    expect(server.html).toContain('<li>a</li><li>b</li><li>c</li>');
    expect(server.html).toContain('<!--[--><p id="more">many</p><!--]-->');

    document.body.innerHTML = server.html;
    const host = document.querySelector('hydrated-list') as HTMLElement;
    const content = host.querySelector<HTMLTemplateElement>(
      'template[data-htms-shadow]'
    )?.content;
    const serverTitle = content?.querySelector('#title');
    const serverFoot = content?.querySelector('#foot');
    new Function(server.code)();
    const result = await hydrate(document);
    expect(result.errors).toEqual([]);

    const element = document.querySelector('hydrated-list') as MountedComponent;
    expect(query(element, '#title')).toBe(serverTitle);
    expect(query(element, '#foot')).toBe(serverFoot);
    expect(rows(element).map((row) => row.textContent)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(query(element, '#more').textContent).toBe('many');

    element.items = ['b'];
    await element.updateComplete;
    expect(rows(element).map((row) => row.textContent)).toEqual(['b']);
    expect(element.shadowRoot.querySelector('#more')).toBeNull();
    expect(query(element, '#foot').textContent).toBe('1');
  });
});
