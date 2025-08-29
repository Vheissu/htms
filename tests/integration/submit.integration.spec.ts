import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('SUBMIT', () => {
  afterEach(() => { document.body.innerHTML=''; });

  test('handles form submit and updates DOM', () => {
    const html = `
      <div id="wrap">
        <form id="f"><input id="v" /><button type="submit">Go</button></form>
        <p id="out"></p>
      </div>
      <submit target="#f">
        <setprop selector="#out" prop="textContent" expr="document.getElementById('v').value"></setprop>
      </submit>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    const sandbox: any = { console, document, window: (global as any).window || global, Event };
    vm.createContext(sandbox);
    vm.runInContext(res.code!, sandbox);
    (document.getElementById('v') as HTMLInputElement).value = 'ok';
    const form = document.getElementById('f') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.getElementById('out')?.textContent).toBe('ok');
  });
});
