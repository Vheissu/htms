import vm from 'vm';
import { parseHTML } from '../../src/parser';

describe('HTMS integration: compile + execute', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    // Clean up DOM between tests
    document.body.innerHTML = '';
  });

  test('calls console.log for each array item', () => {
    const html = `
      <var name="names" value='["Ada","Lin","Ida"]'></var>
      <repeat variable="names">
        <call function="console.log" args="'Hello', item"></call>
      </repeat>
    `;

    const result = parseHTML(html, { strictMode: false, outputFormat: 'cjs' });
    if (!result.success) {
      // Helpful debug if this ever regresses under ts-jest
      // eslint-disable-next-line no-console
      console.error('Integration compile errors:', result.errors);
    }
    expect(result.success).toBe(true);
    expect(result.code).toBeTruthy();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Execute generated code in a sandbox with JSDOM globals
    vm.runInNewContext(result.code!, { console, document });

    expect(logSpy).toHaveBeenNthCalledWith(1, 'Hello', 'Ada');
    expect(logSpy).toHaveBeenNthCalledWith(2, 'Hello', 'Lin');
    expect(logSpy).toHaveBeenNthCalledWith(3, 'Hello', 'Ida');
  });

  test('builds nested DOM elements and appends to body', () => {
    const html = `
      <div id="app">
        <p>Hello</p>
        <span>Welcome</span>
      </div>
    `;

    const result = parseHTML(html, { strictMode: false, outputFormat: 'cjs' });
    expect(result.success).toBe(true);

    vm.runInNewContext(result.code!, { console, document });

    const app = document.querySelector('#app') as HTMLDivElement | null;
    expect(app).not.toBeNull();
    expect(app!.tagName).toBe('DIV');
    expect(app!.children.length).toBe(2);
    expect(app!.children[0].tagName).toBe('P');
    expect(app!.children[1].tagName).toBe('SPAN');
    expect(app!.children[0].textContent).toBe('Hello');
    expect(app!.children[1].textContent).toBe('Welcome');
  });

  test('supports CALL within a REPEAT loop', () => {
    const html = `
      <var name="nums" value='[1,2,3]'></var>
      <repeat variable="nums">
        <call function="console.log" args="'n=', item"></call>
      </repeat>
    `;

    const result = parseHTML(html, { strictMode: false, outputFormat: 'cjs' });
    expect(result.success).toBe(true);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    vm.runInNewContext(result.code!, { console, document });

    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenNthCalledWith(1, 'n=', 1);
    expect(logSpy).toHaveBeenNthCalledWith(2, 'n=', 2);
    expect(logSpy).toHaveBeenNthCalledWith(3, 'n=', 3);
  });

  test('numeric REPEAT executes loop body correct number of times', () => {
    const html = `
      <repeat count="3">
        <call function="console.log" args="'tick'"></call>
      </repeat>
    `;

    const result = parseHTML(html, { strictMode: false, outputFormat: 'cjs' });
    expect(result.success).toBe(true);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    vm.runInNewContext(result.code!, { console, document });
    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(logSpy).toHaveBeenNthCalledWith(1, 'tick');
    expect(logSpy).toHaveBeenNthCalledWith(2, 'tick');
    expect(logSpy).toHaveBeenNthCalledWith(3, 'tick');
  });
});
