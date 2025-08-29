import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('List building with UL/LI and interpolation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('renders LI items from REPEAT using {item} interpolation', () => {
    const html = `
      <var name="names" value='["Ada","Lin","Ida"]'></var>
      <ul id="list">
        <repeat variable="names">
          <li>Item {item}</li>
        </repeat>
      </ul>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    vm.runInNewContext(res.code!, { console, document });
    const list = document.getElementById('list') as HTMLUListElement | null;
    expect(list).not.toBeNull();
    expect(list!.children.length).toBe(3);
    expect(Array.from(list!.children).map(li => li.textContent)).toEqual([
      'Item Ada', 'Item Lin', 'Item Ida'
    ]);
  });
});

