import { ensureRuntime } from '../../src/utils/runtime';

interface BindingRuntime {
  bind(selector: string, property: string, getter: () => unknown): () => void;
  notify(): void;
}

function installRuntime(targetDocument = document): BindingRuntime {
  const host = {} as { __htms: BindingRuntime };
  Function('window', 'document', ensureRuntime())(host, targetDocument);
  return host.__htms;
}

async function flush(runtime: BindingRuntime): Promise<void> {
  runtime.notify();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('runtime binding targets', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses native ID lookup and resolves replacement nodes on each flush', async () => {
    const runtime = installRuntime();
    const first = document.createElement('span');
    first.id = 'binding-target';
    document.body.append(first);
    const idLookup = jest.spyOn(document, 'getElementById');
    const cssLookup = jest.spyOn(document, 'querySelector');
    let value = 'first';
    runtime.bind('#binding-target', 'textContent', (): string => value);
    expect(first.textContent).toBe('first');
    value = 'second';
    await flush(runtime);
    const replacement = document.createElement('span');
    replacement.id = first.id;
    first.replaceWith(replacement);
    value = 'replacement';
    await flush(runtime);
    expect(first.textContent).toBe('second');
    expect(replacement.textContent).toBe('replacement');
    expect(idLookup).toHaveBeenCalledTimes(3);
    expect(cssLookup).not.toHaveBeenCalled();
  });

  it.each([
    ['.target', 'target'],
    ['[id="target"]', 'target'],
    ['#binding\\:target', 'binding:target'],
    ['#-target', '-target'],
    ['#caf\u00e9', 'caf\u00e9'],
  ])('keeps CSS lookup for %s', async (selector, id) => {
    const runtime = installRuntime();
    const target = document.createElement('span');
    target.id = id;
    target.className = 'target';
    document.body.append(target);
    const cssLookup = jest.spyOn(document, 'querySelector');
    let value = 'initial';
    runtime.bind(selector, 'textContent', (): string => value);
    value = 'updated';
    await flush(runtime);
    expect(target.textContent).toBe('updated');
    expect(cssLookup).toHaveBeenCalledTimes(2);
    expect(cssLookup).toHaveBeenLastCalledWith(selector);
  });

  it('uses the first duplicate ID and finds the next after removal', async () => {
    const runtime = installRuntime();
    const first = document.createElement('span');
    const second = document.createElement('span');
    first.id = second.id = 'duplicate';
    document.body.append(first, second);
    runtime.bind('#duplicate', 'textContent', (): string => 'bound');
    expect(first.textContent).toBe('bound');
    expect(second.textContent).toBe('');
    first.remove();
    await flush(runtime);
    expect(second.textContent).toBe('bound');
  });

  it('retains missing-target disposal and explicit cancellation', async () => {
    const runtime = installRuntime();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const missingGetter = jest.fn((): string => 'missing');
    runtime.bind('#missing', 'textContent', missingGetter);
    await flush(runtime);
    const target = document.createElement('span');
    target.id = 'missing';
    document.body.append(target);
    await flush(runtime);
    expect(missingGetter).not.toHaveBeenCalled();
    expect(target.textContent).toBe('');
    let value = 'initial';
    const cancel = runtime.bind('#missing', 'textContent', (): string => value);
    cancel();
    value = 'cancelled';
    await flush(runtime);
    expect(target.textContent).toBe('initial');
  });

  it('retains invalid-selector error handling', async () => {
    const runtime = installRuntime();
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const getter = jest.fn();
    runtime.bind('#', 'textContent', getter);
    await flush(runtime);
    expect(getter).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.map((call) => call[0])).toEqual([
      'BIND compute failed:',
      'HTMS watcher update failed:',
    ]);
  });

  it('retains CSS lookup in quirks mode', () => {
    const quirks = document.implementation.createHTMLDocument();
    quirks.open();
    quirks.write('<html><body><span id="UPPER"></span></body></html>');
    quirks.close();
    expect(quirks.compatMode).toBe('BackCompat');
    const cssLookup = jest.spyOn(quirks, 'querySelector');
    const runtime = installRuntime(quirks);
    runtime.bind('#UPPER', 'textContent', (): string => 'quirks');
    expect(quirks.getElementById('UPPER')?.textContent).toBe('quirks');
    expect(cssLookup).toHaveBeenCalledWith('#UPPER');
  });

  it('retains CSS lookup for XML documents', () => {
    const xml = new DOMParser().parseFromString(
      '<root><item id="target" /></root>',
      'application/xml'
    );
    const cssLookup = jest.spyOn(xml, 'querySelector');
    const runtime = installRuntime(xml);
    runtime.bind('#target', 'textContent', (): string => 'xml');
    expect(xml.documentElement.textContent).toBe('xml');
    expect(cssLookup).toHaveBeenCalledWith('#target');
  });
});
