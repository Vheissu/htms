import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('SETPROP/SETATTR/APPEND basics', () => {
  afterEach(() => { document.body.innerHTML=''; });

  test('append creates children under target and setattr sets attributes', () => {
    const html = `
      <ul id="r"></ul>
      <setattr selector="#r" name="data-x" value="y"></setattr>
      <append target="#r">
        <li>Hi</li>
      </append>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document });
    const ul = document.getElementById('r') as HTMLUListElement;
    expect(ul.getAttribute('data-x')).toBe('y');
    expect(ul.children.length).toBe(1);
    expect(ul.children[0].textContent).toBe('Hi');
  });
});

