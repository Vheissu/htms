import { ensureRuntime } from '../../src/utils/runtime';

interface EffectRegistration {
  owner: unknown;
  id: string;
  deps: Array<() => unknown>;
  immediate?: boolean;
  once?: boolean;
  run: () => void | (() => void) | Promise<void | (() => void)>;
}

interface EffectHandle {
  dispose: () => void;
}

interface HtmsRuntime {
  effects: Array<{ owner: unknown; disposed: boolean }>;
  pendingEffects: Array<{ owner: unknown; disposed: boolean }>;
  bind: (selector: string, property: string, getter: () => unknown) => void;
  notify: () => void;
  registerEffect: (effect: EffectRegistration) => EffectHandle;
  disposeEffectsFor: (owner: unknown) => void;
}

let runtimeWindow: { __htms?: HtmsRuntime } = {};

function applyRuntime(): void {
  // The runtime property is non-configurable, so each test needs a fresh host.
  runtimeWindow = {};
  const runtimeScript = ensureRuntime();
  Function('window', runtimeScript)(runtimeWindow);
}

function getRuntime(): HtmsRuntime {
  if (!runtimeWindow.__htms) {
    throw new Error('HTMS runtime was not installed');
  }
  return runtimeWindow.__htms;
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
    runtimeWindow = {};
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

  it('updates an existing owner/id registration without duplicating it', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let dependency = 0;
    let firstCalls = 0;
    let secondCalls = 0;

    const register = (run: () => void): void => {
      runtime.registerEffect({
        owner,
        id: 'effect:replace',
        deps: [(): number => dependency],
        run,
      });
    };

    register(() => {
      firstCalls += 1;
    });
    await flushMicrotasks();
    expect(firstCalls).toBe(1);

    dependency = 1;
    register(() => {
      secondCalls += 1;
    });
    await flushMicrotasks();
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);

    register(() => {
      secondCalls += 1;
    });
    await flushMicrotasks();
    expect(secondCalls).toBe(1);
  });

  it('keeps the same effect id independent for different owners', async () => {
    const runtime = getRuntime();
    const firstOwner = document.createElement('div');
    const secondOwner = document.createElement('div');
    document.body.append(firstOwner, secondOwner);
    let firstCalls = 0;
    let secondCalls = 0;

    runtime.registerEffect({
      owner: firstOwner,
      id: 'effect:owners',
      deps: [(): Element => firstOwner],
      run: (): void => {
        firstCalls += 1;
      },
    });
    runtime.registerEffect({
      owner: secondOwner,
      id: 'effect:owners',
      deps: [(): Element => secondOwner],
      run: (): void => {
        secondCalls += 1;
      },
    });
    await flushMicrotasks();

    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
  });

  it('can recreate a disposed owner/id registration', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let calls = 0;

    const first = runtime.registerEffect({
      owner,
      id: 'effect:recreate',
      deps: [],
      run: (): void => {
        calls += 1;
      },
    });
    await flushMicrotasks();
    expect(calls).toBe(1);

    first.dispose();
    runtime.registerEffect({
      owner,
      id: 'effect:recreate',
      deps: [],
      run: (): void => {
        calls += 1;
      },
    });
    await flushMicrotasks();
    expect(calls).toBe(2);
  });

  it('can re-register an effect after a one-shot run is removed', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let calls = 0;
    const register = (): void => {
      runtime.registerEffect({
        owner,
        id: 'effect:once',
        deps: [],
        once: true,
        run: (): void => {
          calls += 1;
        },
      });
    };

    register();
    await flushMicrotasks();
    register();
    await flushMicrotasks();
    expect(calls).toBe(2);
  });

  it('runs async cleanup when an effect is disposed before it resolves', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let resolveRun!: (cleanup: () => void) => void;
    let cleanupCalls = 0;

    runtime.registerEffect({
      owner,
      id: 'effect:async-cleanup',
      deps: [],
      run: (): Promise<() => void> =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    });
    await flushMicrotasks();

    runtime.disposeEffectsFor(owner);
    resolveRun(() => {
      cleanupCalls += 1;
    });
    await flushMicrotasks();

    expect(cleanupCalls).toBe(1);
  });

  it('runs cleanup when an effect disposes itself during execution', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let cleanupCalls = 0;

    runtime.registerEffect({
      owner,
      id: 'effect:sync-dispose',
      deps: [],
      run: (): (() => void) => {
        runtime.disposeEffectsFor(owner);
        return (): void => {
          cleanupCalls += 1;
        };
      },
    });
    await flushMicrotasks();

    expect(cleanupCalls).toBe(1);
  });

  it('cleans up stale async runs without replacing the latest cleanup', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    let dependency = 0;
    const completions: Array<(cleanup: () => void) => void> = [];
    const staleCleanup = jest.fn();
    const latestCleanup = jest.fn();
    runtime.registerEffect({
      owner,
      id: 'effect:async-order',
      deps: [(): number => dependency],
      run: (): Promise<() => void> =>
        new Promise((resolve) => completions.push(resolve)),
    });
    await flushMicrotasks();
    dependency = 1;
    runtime.notify();
    await flushMicrotasks();

    expect(completions).toHaveLength(2);
    completions[1](latestCleanup);
    await flushMicrotasks();
    completions[0](staleCleanup);
    await flushMicrotasks();
    expect(staleCleanup).toHaveBeenCalledTimes(1);
    expect(latestCleanup).not.toHaveBeenCalled();

    runtime.disposeEffectsFor(owner);
    expect(latestCleanup).toHaveBeenCalledTimes(1);
    expect(staleCleanup).toHaveBeenCalledTimes(1);
  });

  it('retains effects registered while another effect is flushing', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    const dependency = 0;
    let calls = 0;
    let pendingCount = 0;

    runtime.registerEffect({
      owner,
      id: 'effect:register-during-flush',
      deps: [(): number => dependency],
      run: (): void => {
        runtime.registerEffect({
          owner,
          id: 'effect:registered-during-flush',
          deps: [(): number => dependency],
          run: (): void => {
            calls += 1;
          },
        });
        runtime.disposeEffectsFor(document.createElement('div'));
        pendingCount = runtime.pendingEffects.length;
      },
    });
    await flushMicrotasks();

    expect(calls).toBe(1);
    expect(pendingCount).toBe(1);
  });

  it('retains an effect recreated by cleanup during owner disposal', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    const dependency = 0;
    let calls = 0;
    let recreated = false;

    const register = (): void => {
      runtime.registerEffect({
        owner,
        id: 'effect:cleanup-recreate',
        deps: [(): number => dependency],
        run: (): (() => void) => {
          calls += 1;
          return (): void => {
            if (!recreated) {
              recreated = true;
              runtime.registerEffect({
                owner,
                id: 'effect:cleanup-recreate',
                deps: [(): number => dependency],
                run: (): void => {
                  calls += 1;
                },
              });
            }
          };
        },
      });
    };

    register();
    await flushMicrotasks();
    expect(calls).toBe(1);

    runtime.disposeEffectsFor(owner);
    await flushMicrotasks();

    expect(calls).toBe(2);
  });

  it('keeps surviving effects when cleanup disposes another owner', async () => {
    const runtime = getRuntime();
    const ownerA = document.createElement('div');
    const ownerB = document.createElement('div');
    const ownerC = document.createElement('div');
    document.body.append(ownerA, ownerB, ownerC);
    let dependency = 0;
    let callsC = 0;

    runtime.registerEffect({
      owner: ownerA,
      id: 'effect:nested-dispose-a',
      deps: [(): number => dependency],
      run: (): (() => void) => {
        return (): void => {
          runtime.disposeEffectsFor(ownerB);
        };
      },
    });
    runtime.registerEffect({
      owner: ownerB,
      id: 'effect:nested-dispose-b',
      deps: [(): number => dependency],
      run: (): void => undefined,
    });
    runtime.registerEffect({
      owner: ownerC,
      id: 'effect:nested-dispose-c',
      deps: [(): number => dependency],
      run: (): void => {
        callsC += 1;
      },
    });
    await flushMicrotasks();

    runtime.disposeEffectsFor(ownerA);
    dependency = 1;
    runtime.notify();
    await flushMicrotasks();

    expect(callsC).toBe(2);
  });

  it('does not scan live effects when an unrelated component disconnects', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    document.body.appendChild(owner);
    const run = jest.fn();
    for (let i = 0; i < 100; i++) {
      runtime.registerEffect({
        owner,
        id: `effect:unrelated:${i}`,
        deps: [(): number => 0],
        run,
      });
    }
    await flushMicrotasks();
    const readOwner = jest.fn((): HTMLElement => owner);
    for (const effect of runtime.effects) {
      Object.defineProperty(effect, 'owner', { get: readOwner });
    }

    runtime.disposeEffectsFor(document.createElement('div'));

    expect(readOwner).not.toHaveBeenCalled();
    expect(runtime.effects).toHaveLength(100);
    expect(run).toHaveBeenCalledTimes(100);
  });

  it.each([true, false])(
    'compacts handle-disposed effects when disposing an empty owner (same owner: %s)',
    async (sameOwner) => {
      const runtime = getRuntime();
      const owner = document.createElement('div');
      document.body.appendChild(owner);
      const cleanup = jest.fn();
      const handle = runtime.registerEffect({
        owner,
        id: 'effect:handle-compaction',
        deps: [],
        run: (): (() => void) => cleanup,
      });
      await flushMicrotasks();

      handle.dispose();
      runtime.disposeEffectsFor(
        sameOwner ? owner : document.createElement('div')
      );

      expect(runtime.effects).toHaveLength(0);
      expect(runtime.pendingEffects).toHaveLength(0);
      expect(cleanup).toHaveBeenCalledTimes(1);
    }
  );

  it('drops pending effects disposed during cleanup and preserves survivors', async () => {
    const runtime = getRuntime();
    const owner = document.createElement('div');
    const survivor = document.createElement('div');
    document.body.append(owner, survivor);
    const pendingRun = jest.fn();
    const survivorRun = jest.fn();
    runtime.registerEffect({
      owner,
      id: 'effect:pending-cleanup',
      deps: [],
      run: (): (() => void) => (): void => {
        const pending = runtime.registerEffect({
          owner,
          id: 'effect:disposed-pending',
          deps: [],
          run: pendingRun,
        });
        pending.dispose();
      },
    });
    runtime.registerEffect({
      owner: survivor,
      id: 'effect:survivor',
      deps: [(): number => 0],
      run: survivorRun,
    });
    await flushMicrotasks();

    runtime.disposeEffectsFor(owner);
    expect(runtime.effects.map((effect) => effect.owner)).toEqual([survivor]);
    expect(runtime.pendingEffects).toHaveLength(0);
    await flushMicrotasks();

    expect(pendingRun).not.toHaveBeenCalled();
    expect(survivorRun).toHaveBeenCalledTimes(1);
    expect(runtime.effects).toHaveLength(1);
  });
});
