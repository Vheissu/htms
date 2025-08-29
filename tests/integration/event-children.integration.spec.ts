import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('EVENT with child tags', () => {
  afterEach(() => { document.body.innerHTML=''; });

  test('click updates text via SETPROP expr', () => {
    const html = `
      <button id="b">Go</button>
      <p id="p"></p>
      <event target="#b" type="click">
        <setprop selector="#p" prop="textContent" expr="'clicked'"></setprop>
      </event>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document });
    const btn = document.getElementById('b')!;
    btn.dispatchEvent(new (window as any).Event('click', { bubbles: true }));
    expect(document.getElementById('p')?.textContent).toBe('clicked');
  });
});

