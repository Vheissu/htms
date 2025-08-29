import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('SET tag and mutable VAR', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('mutates object property and logs result', () => {
    const html = `
      <var name="state" value="{}"></var>
      <set name="state.count" value="1"></set>
      <set name="state.count" op="+=" value="2"></set>
      <call function="console.log" args="state.count"></call>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    vm.runInNewContext(res.code!, { console, document });
    expect(spy).toHaveBeenCalledWith(3);
  });

  test('mutable VAR allows reassignment via SET', () => {
    const html = `
      <var name="x" value="1" mutable="true"></var>
      <set name="x" op="+=" value="4"></set>
      <call function="console.log" args="x"></call>
    `;
    const res = parseHTML(html, { outputFormat: 'cjs' });
    expect(res.success).toBe(true);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    vm.runInNewContext(res.code!, { console, document });
    expect(spy).toHaveBeenCalledWith(5);
  });
});

