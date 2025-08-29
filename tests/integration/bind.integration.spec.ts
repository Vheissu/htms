import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('BIND + reactive updates via SET/PUSH/SPLICE', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('binds textContent to expression and updates on SET', () => {
    const html = `
      <var name="state" value='{"count":0}' mutable="true"></var>
      <p id="out"></p>
      <bind selector="#out" prop="textContent" expr="String(state.count)"></bind>
      <set name="state.count" op="+=" value="5"></set>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document, window: (global as any).window || global });
    const out = document.getElementById('out');
    expect(out?.textContent).toBe('5');
  });

  test('bind reflects array length after PUSH and SPLICE', () => {
    const html = `
      <var name="state" value='{"todos":[]}' mutable="true"></var>
      <p id="len"></p>
      <bind selector="#len" prop="textContent" expr="String(state.todos.length)"></bind>
      <push array="state.todos" value="'a'"></push>
      <push array="state.todos" value="'b'"></push>
      <splice array="state.todos" index="0" delete="1"></splice>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document, window: (global as any).window || global });
    expect(document.getElementById('len')?.textContent).toBe('1');
  });
});

