import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('SHOW/TOGGLE', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('show toggles visibility based on condition', () => {
    const html = `
      <var name="x" value="10" mutable="true"></var>
      <p id="a">A</p>
      <p id="b">B</p>
      <show target="#a" when="x > 5"></show>
      <show target="#b" when="x <= 5"></show>
      <set name="x" op="=" value="3"></set>
      <show target="#a" when="x > 5"></show>
      <show target="#b" when="x <= 5"></show>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document });
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    expect((a as HTMLElement).style.display).toBe('none');
    expect((b as HTMLElement).style.display).toBe('');
  });
});

