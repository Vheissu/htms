import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { htms } from '../src/vite';

describe('Vite integration', () => {
  let directory: string;
  const source = `<component name="vite-counter">
    <var name="count" value="0" mutable="true"></var>
    <button on:click="count++">Count: {count}</button>
  </component>`;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-vite-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  function context(): {
    addWatchFile: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock<never, [{ message: string }]>;
  } {
    return {
      addWatchFile: jest.fn(),
      warn: jest.fn(),
      error: jest.fn((diagnostic: { message: string }): never => {
        throw new Error(diagnostic.message);
      }),
    };
  }

  it('compiles explicit component imports with registration side effects', async () => {
    const file = path.join(directory, 'counter.html');
    await fs.writeFile(file, source);
    const hooks = htms();
    const loader = context();
    const result = await hooks.load.call(loader, `${file}?htms`);

    expect(result?.code).toMatch(/export\s*\{\s*ViteCounterComponent\s*\}/);
    expect(result?.code).toContain("customElements.define('vite-counter'");
    expect(result?.moduleSideEffects).toBe(true);
    expect(result?.map).toBeNull();
    expect(loader.addWatchFile).toHaveBeenCalledWith(file);
    expect(loader.error).not.toHaveBeenCalled();
  });

  it.each([
    'index.html',
    'component.html?raw',
    'component.html?url',
    'component.html?htms&raw',
    'component.html?htms&url',
    'main.js?htms',
    '\0component.html?htms',
  ])('leaves other Vite resources alone: %s', async (id) => {
    const loader = context();
    expect(await htms().load.call(loader, id)).toBeNull();
    expect(loader.addWatchFile).not.toHaveBeenCalled();
  });

  it('accepts .htm imports and Vite cache query parameters', async () => {
    const file = path.join(directory, 'counter.htm');
    await fs.writeFile(file, source);
    expect(
      await htms().load.call(context(), `${file}?htms&t=123&import`)
    ).not.toBeNull();
  });

  it('reports compiler warnings with input locations', async () => {
    const file = path.join(directory, 'warning.html');
    await fs.writeFile(
      file,
      '<component name="warning-widget" shadow="bad"><p>Hello</p></component>'
    );
    const loader = context();
    expect(await htms().load.call(loader, `${file}?htms`)).not.toBeNull();
    expect(loader.warn).toHaveBeenCalledWith({
      message: expect.stringContaining('Invalid shadow mode'),
      id: `${file}?htms`,
      loc: { file, line: 1, column: 0 },
    });
  });

  it('reports missing component files through Vite', async () => {
    const id = `${path.join(directory, 'missing.html')}?htms`;
    const loader = context();
    await expect(htms().load.call(loader, id)).rejects.toThrow(
      /Cannot read HTMS component/
    );
    expect(loader.error).toHaveBeenCalledWith({
      id,
      message: expect.stringContaining('ENOENT'),
    });
  });

  it('reports input locations and compiler hints to Vite', async () => {
    const file = path.join(directory, 'broken.html');
    await fs.writeFile(
      file,
      '<component name="broken-widget">\n  <var value="1"></var>\n</component>'
    );
    const loader = context();
    await expect(htms().load.call(loader, `${file}?htms`)).rejects.toThrow();
    expect(loader.error).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${file}?htms`,
        loc: { file, line: 2, column: 2 },
      })
    );
  });

  it('passes compiler options through without allowing output overrides', async () => {
    const file = path.join(directory, 'counter.html');
    await fs.writeFile(file, source);
    await expect(
      htms({ maxFileSize: 10 }).load.call(context(), `${file}?htms`)
    ).rejects.toThrow(/size/i);
    const result = await htms({ renderer: 'legacy' }).load.call(
      context(),
      `${file}?htms`
    );
    expect(result?.code).toContain('__htmsReconcile');
    expect(result?.code).toMatch(/export\s*\{\s*ViteCounterComponent\s*\}/);
  });

  it('invalidates every import before reloading changed component classes', () => {
    const modules = [{ id: '/counter.html?htms' }, { id: '/counter.html?raw' }];
    const invalidateModule = jest.fn();
    const send = jest.fn(() => {
      expect(invalidateModule).toHaveBeenCalledTimes(2);
    });
    const result = htms().handleHotUpdate({
      modules,
      timestamp: 42,
      server: { moduleGraph: { invalidateModule }, ws: { send } },
    });
    expect(result).toEqual([]);
    expect(invalidateModule).toHaveBeenCalledWith(
      modules[0],
      expect.any(Set),
      42,
      true
    );
    expect(send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('measures the size limit in UTF-8 bytes', async () => {
    const file = path.join(directory, 'unicode.html');
    const content = '<component name="unicode-widget"><p>ééé</p></component>';
    await fs.writeFile(file, content);
    await expect(
      htms({ maxFileSize: content.length }).load.call(context(), `${file}?htms`)
    ).rejects.toThrow(/File too large/);
  });

  it.each([0, -1, NaN, Infinity, 1.5])(
    'rejects invalid size limits: %s',
    (maxFileSize) => {
      expect(() => htms({ maxFileSize })).toThrow(/positive integer/);
    }
  );

  it('applies the compiler security checks in strict mode', async () => {
    const file = path.join(directory, 'unsafe.html');
    await fs.writeFile(
      file,
      '<component name="unsafe-widget"><button onclick="alert(1)">Click</button></component>'
    );
    await expect(
      htms({ strictMode: true }).load.call(context(), `${file}?htms`)
    ).rejects.toThrow();
  });

  it('leaves HMR for ordinary files to Vite', () => {
    const invalidateModule = jest.fn();
    const send = jest.fn();
    expect(
      htms().handleHotUpdate({
        modules: [{ id: '/index.html' }, { id: null }],
        timestamp: 42,
        server: { moduleGraph: { invalidateModule }, ws: { send } },
      })
    ).toBeUndefined();
    expect(invalidateModule).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
