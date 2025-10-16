import { ensureRuntime } from '../../src/utils/runtime';

declare global {
  interface Window {
    __htms?: any;
  }
}

function applyRuntime(): void {
  delete (window as any).__htms;
  const runtimeScript = ensureRuntime();
  // Execute generated bootstrap script in the current window context
  Function(runtimeScript)();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('HTMS runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    applyRuntime();
  });

  afterEach(() => {
    delete (window as any).__htms;
  });

  it('updates bound nodes when notify is triggered', async () => {
    const container = document.createElement('div');
    container.id = 'out';
    document.body.appendChild(container);

    let value = 'first';
    window.__htms.bind('#out', 'textContent', () => value);
    expect(container.textContent).toBe('first');

    value = 'second';
    window.__htms.notify();
    await flushMicrotasks();
    expect(container.textContent).toBe('second');
  });

  it('re-runs effects when dependencies change', async () => {
    let dep = 0;
    let calls = 0;

    window.__htms.registerEffect({
      owner: null,
      id: 'effect:test',
      deps: [() => dep],
      run: () => {
        calls += 1;
      }
    });

    await flushMicrotasks();
    expect(calls).toBe(1);

    dep = 1;
    window.__htms.notify();
    await flushMicrotasks();
    expect(calls).toBe(2);
  });

  it('runs cleanup when effects are disposed', async () => {
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let cleanupCount = 0;

    window.__htms.registerEffect({
      owner,
      id: 'effect:cleanup',
      deps: [],
      run: () => {
        return () => {
          cleanupCount += 1;
        };
      }
    });

    await flushMicrotasks();
    expect(cleanupCount).toBe(0);

    window.__htms.disposeEffectsFor(owner);
    await flushMicrotasks();
    expect(cleanupCount).toBe(1);
  });
});
