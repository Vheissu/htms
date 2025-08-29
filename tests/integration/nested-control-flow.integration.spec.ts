import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('Nested control flow (IF/ELSE, REPEAT)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  test('nested REPEAT loops execute inner body per outer item', () => {
    const html = `
      <var name="outer" value='["A","B"]'></var>
      <repeat variable="outer">
        <repeat count="2">
          <call function="console.log" args="'pair', item, i"></call>
        </repeat>
      </repeat>
    `;

    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    vm.runInNewContext(res.code!, { console, document });
    expect(spy).toHaveBeenCalledTimes(4); // 2 outer * 2 inner
    expect(spy).toHaveBeenNthCalledWith(1, 'pair', 'A', 0);
    expect(spy).toHaveBeenNthCalledWith(4, 'pair', 'B', 1);
  });

  test('IF/ELSE inside REPEAT branches correctly', () => {
    const html = `
      <var name="names" value='["Ada","Lin","Ida"]'></var>
      <repeat variable="names">
        <if condition="item === 'Lin'">
          <call function="console.log" args="'match', item"></call>
        </if>
        <else>
          <call function="console.log" args="'skip', item"></call>
        </else>
      </repeat>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    vm.runInNewContext(res.code!, { console, document });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(1, 'skip', 'Ada');
    expect(spy).toHaveBeenNthCalledWith(2, 'match', 'Lin');
    expect(spy).toHaveBeenNthCalledWith(3, 'skip', 'Ida');
  });
});

