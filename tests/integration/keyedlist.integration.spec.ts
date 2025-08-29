import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('KEYEDLIST', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('creates items with data-key and appends in order', () => {
    const html = `
      <var name="state" value='{"items":[{"id":1,"name":"A"},{"id":2,"name":"B"}]}' mutable="true"></var>
      <ul id="ul"></ul>
      <function name="render">
        <keyedlist target="#ul" of="state.items" item="it" index="i" key="it.id">
          <li>{it.name}</li>
        </keyedlist>
      </function>
      <call function="render"></call>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document, window: (global as any).window || global });
    const lis = Array.from(document.querySelectorAll('#ul li')) as HTMLLIElement[];
    expect(lis.length).toBe(2);
    expect(lis[0].getAttribute('data-key')).toBe('1');
    expect(lis[1].getAttribute('data-key')).toBe('2');
  });

  test('reorders existing nodes instead of re-creating', () => {
    const html = `
      <var name="state" value='{"items":[{"id":1,"name":"A"},{"id":2,"name":"B"}]}' mutable="true"></var>
      <ul id="ul"></ul>
      <function name="render">
        <keyedlist target="#ul" of="state.items" item="it" index="i" key="it.id">
          <li>{it.name}</li>
        </keyedlist>
      </function>
      <call function="render"></call>
      <!-- swap order -->
      <set name="state.items" value='[{"id":2,"name":"B"},{"id":1,"name":"A"}]'></set>
      <call function="render"></call>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document, window: (global as any).window || global });
    const lis = Array.from(document.querySelectorAll('#ul li')) as HTMLLIElement[];
    expect(lis.length).toBe(2);
    expect(lis[0].getAttribute('data-key')).toBe('2');
    expect(lis[1].getAttribute('data-key')).toBe('1');
  });
});

