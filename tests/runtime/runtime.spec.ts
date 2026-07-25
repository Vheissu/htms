import { ensureRuntime } from '../../src/utils/runtime';

interface EffectRegistration {
  owner: unknown;
  id: string;
  deps: Array<() => unknown>;
  run: () => void | (() => void);
}

interface HtmsRuntime {
  bind: (selector: string, property: string, getter: () => unknown) => void;
  notify: () => void;
  registerEffect: (effect: EffectRegistration) => void;
  disposeEffectsFor: (owner: unknown) => void;
}

declare global {
  interface Window {
    __htms?: HtmsRuntime;
  }
}

function applyRuntime(): void {
  delete window.__htms;
  const runtimeScript = ensureRuntime();
  // Execute generated bootstrap script in the current window context
  Function(runtimeScript)();
}

function getRuntime(): HtmsRuntime {
  if (!window.__htms) {
    throw new Error('HTMS runtime was not installed');
  }
  return window.__htms;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('HTMS runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    applyRuntime();
  });

  afterEach(() => {
    delete window.__htms;
  });

  it('updates bound nodes when notify is triggered', async () => {
    const container = document.createElement('div');
    container.id = 'out';
    document.body.appendChild(container);

    let value = 'first';
    getRuntime().bind('#out', 'textContent', () => value);
    expect(container.textContent).toBe('first');

    value = 'second';
    getRuntime().notify();
    await flushMicrotasks();
    expect(container.textContent).toBe('second');
  });

  it('re-runs effects when dependencies change', async () => {
    let dep = 0;
    let calls = 0;

    getRuntime().registerEffect({
      owner: null,
      id: 'effect:test',
      deps: [(): number => dep],
      run: (): void => {
        calls += 1;
      },
    });

    await flushMicrotasks();
    expect(calls).toBe(1);

    dep = 1;
    getRuntime().notify();
    await flushMicrotasks();
    expect(calls).toBe(2);
  });

  it('runs cleanup when effects are disposed', async () => {
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let cleanupCount = 0;

    getRuntime().registerEffect({
      owner,
      id: 'effect:cleanup',
      deps: [],
      run: (): (() => void) => {
        return (): void => {
          cleanupCount += 1;
        };
      },
    });

    await flushMicrotasks();
    expect(cleanupCount).toBe(0);

    getRuntime().disposeEffectsFor(owner);
    await flushMicrotasks();
    expect(cleanupCount).toBe(1);
  });

  it('re-runs an immediate effect when a render registers it again', async () => {
    let calls = 0;
    const register = (): void => {
      getRuntime().registerEffect({
        owner: null,
        id: 'effect:render',
        deps: [],
        run: (): void => {
          calls += 1;
        },
      });
    };

    register();
    await flushMicrotasks();
    expect(calls).toBe(1);

    register();
    await flushMicrotasks();
    expect(calls).toBe(2);
  });
});
