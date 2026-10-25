export function ensureRuntime(): string {
  return `(function(){
    if (typeof window === 'undefined') return;
    if (!window.__htms) {
      const runtime = {
        watchers: [],
        effects: [],
        pendingEffects: [],
        flushingEffects: false,
        effectMutationDepth: 0,
        // Keep the single disposed record as a compaction hint; true means
        // multiple disposals require scanning from the beginning.
        effectsNeedCompaction: false,
        // Effects are registered from every component render. Looking up an
        // existing record by scanning the whole effects array makes a page
        // with many components quadratic in the number of registrations.
        // Keep the array for flush ordering, and index records by owner/id
        // for constant-time re-registration.
        effectOwners: new WeakMap(),
        globalEffects: new Map(),
        primitiveEffects: new Map(),
        effectIndex: function(owner, create){
          if (owner !== null &&
              (typeof owner === 'object' || typeof owner === 'function')) {
            let index = this.effectOwners.get(owner);
            if (!index && create) {
              index = new Map();
              this.effectOwners.set(owner, index);
            }
            return index;
          }
          if (owner === null) {
            return this.globalEffects;
          }
          let index = this.primitiveEffects.get(owner);
          if (!index && create) {
            index = new Map();
            this.primitiveEffects.set(owner, index);
          }
          return index;
        },
        removeEffectIndex: function(effect){
          const index = this.effectIndex(effect.owner, false);
          if (index && index.get(effect.id) === effect) {
            index.delete(effect.id);
            if (effect.owner !== null &&
                typeof effect.owner !== 'object' &&
                typeof effect.owner !== 'function' &&
                index.size === 0) {
              this.primitiveEffects.delete(effect.owner);
            }
          }
        },
        compactEffects: function(effects){
          if (!this.effectsNeedCompaction) {
            return;
          }
          // A single disposal can locate its first hole with a native
          // reference search instead of inspecting every live prefix record.
          let write = this.effectsNeedCompaction === true
            ? 0 : effects.indexOf(this.effectsNeedCompaction);
          if (write < 0) write = 0;
          while (write < effects.length && !effects[write].disposed) {
            write++;
          }
          for (let read = write + 1; read < effects.length; read++) {
            const effect = effects[read];
            if (!effect.disposed) {
              effects[write++] = effect;
            }
          }
          effects.length = write;
          this.effectsNeedCompaction = false;
        },
        commitPendingEffects: function(){
          if (this.flushingEffects || this.effectMutationDepth > 0) {
            return;
          }
          const pending = this.pendingEffects;
          this.pendingEffects = [];
          for (let i = 0; i < pending.length; i++) {
            const effect = pending[i];
            if (effect.disposed) {
              this.removeEffectIndex(effect);
            } else {
              this.effects.push(effect);
            }
          }
        },
        flushScheduled: false,
        scheduleFlush: function(){
          if (this.flushScheduled) {
            return;
          }
          this.flushScheduled = true;
          const runFlush = () => {
            this.flushScheduled = false;
            try {
              this.flush();
            } catch (error) {
              console.error('HTMS runtime flush failed:', error);
            }
          };
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(runFlush);
          } else {
            Promise.resolve().then(runFlush);
          }
        },
        flush: function(){
          this.watchers = this.watchers.filter(function(watcher){
            if (watcher.disposed) {
              return false;
            }
            try {
              const el = watcher.id !== null
                ? document.getElementById(watcher.id)
                : document.querySelector(watcher.sel);
              if (!el) {
                if (watcher.autoDispose) {
                  watcher.disposed = true;
                  return false;
                }
                return true;
              }
              el[watcher.prop] = watcher.fn();
            } catch (error) {
              console.error('HTMS watcher update failed:', error);
            }
            return !watcher.disposed;
          });
          this.commitPendingEffects();
          const effects = this.effects;
          const effectCount = effects.length;
          this.flushingEffects = true;
          try {
            for (let effectIndex = 0; effectIndex < effectCount; effectIndex++) {
              const effect = effects[effectIndex];
              if (effect.disposed) {
                continue;
              }
              if (effect.owner && !effect.owner.isConnected) {
                effect.dispose();
                continue;
              }
              const previousValues = effect.lastValues;
              let values = null;
              let valueCount = 0;
              let shouldRun = effect.dirty || effect.depsFns.length === 0;
              for (let i = 0; i < effect.depsFns.length; i++) {
                let value;
                try {
                  value = effect.depsFns[i]();
                } catch (error) {
                  console.error('HTMS effect dependency failed:', error);
                  value = undefined;
                }
                if (i >= previousValues.length || previousValues[i] !== value) {
                  shouldRun = true;
                  if (values === null) {
                    values = previousValues.slice(0, i);
                  }
                }
                if (values !== null) {
                  values.push(value);
                }
                valueCount++;
              }
              effect.lastValues = values !== null ? values
                : valueCount === previousValues.length ? previousValues
                : previousValues.slice(0, valueCount);
              if (effect.skipInitial && !effect.initialized) {
                effect.skipInitial = false;
                effect.dirty = false;
                effect.initialized = true;
                continue;
              }
              if (shouldRun) {
                effect.dirty = false;
                effect.execute();
                effect.initialized = true;
                if (effect.once) {
                  effect.dispose();
                }
              }
            }
          } finally {
            this.flushingEffects = false;
            this.compactEffects(effects);
            this.commitPendingEffects();
          }
        },
        bind: function(sel, prop, fn){
          // getElementById finds what querySelector('#id') would for a plain
          // ID in a standards-mode HTML document, without parsing a selector.
          // Quirks mode matches IDs case-insensitively and XML has its own ID
          // rules, so those keep the CSS lookup.
          const id = typeof sel === 'string' &&
            /^#[A-Za-z_][A-Za-z0-9_-]*$/.test(sel) &&
            document.compatMode === 'CSS1Compat' &&
            document.contentType === 'text/html' ? sel.slice(1) : null;
          const watcher = { sel, id, prop, fn, disposed: false, autoDispose: true };
          this.watchers.push(watcher);
          try {
            const el = id !== null ? document.getElementById(id) : document.querySelector(sel);
            if (!el) {
              console.warn('BIND target not found:', sel);
            } else {
              el[prop] = fn();
            }
          } catch (error) {
            console.error('BIND compute failed:', error);
          }
          return () => { watcher.disposed = true; };
        },
        notify: function(){
          this.scheduleFlush();
        },
        registerEffect: function(spec){
          if (!spec || !spec.id) {
            console.error('HTMS effect requires an id');
            return { dispose: function(){} };
          }
          const owner = spec.owner || null;
          const deps = Array.isArray(spec.deps) ? spec.deps.filter(fn => typeof fn === 'function') : [];
          const runtime = this;
          const index = this.effectIndex(owner, true);
          let record = index.get(spec.id);
          if (!record) {
            record = {
              owner,
              id: spec.id,
              depsFns: deps,
              run: typeof spec.run === 'function' ? spec.run : function(){},
              cleanupFactory: typeof spec.cleanup === 'function' ? spec.cleanup : undefined,
              cleanup: undefined,
              lastValues: [],
              disposed: false,
              dirty: spec.immediate !== false,
              once: !!spec.once,
              initialized: false,
              skipInitial: spec.immediate === false,
              runVersion: 0,
              dispose: function(){
                if (record.disposed) {
                  return;
                }
                record.disposed = true;
                runtime.effectsNeedCompaction = runtime.effectsNeedCompaction
                  ? true : record;
                record.runVersion++;
                runtime.removeEffectIndex(record);
                runtime.effectMutationDepth++;
                try {
                  if (typeof record.cleanup === 'function') {
                    try {
                      record.cleanup();
                    } catch (error) {
                      console.error('HTMS effect cleanup failed:', error);
                    }
                  }
                } finally {
                  runtime.effectMutationDepth--;
                }
                record.cleanup = undefined;
                record.initialized = false;
                record.skipInitial = false;
                runtime.commitPendingEffects();
              },
              execute: function(){
                if (record.disposed) {
                  return;
                }
                const runVersion = ++record.runVersion;
                if (typeof record.cleanup === 'function') {
                  try {
                    record.cleanup();
                  } catch (error) {
                    console.error('HTMS effect cleanup failed:', error);
                  }
                  record.cleanup = undefined;
                }
                if (record.disposed) {
                  return;
                }
                let nextCleanup = record.cleanupFactory;
                const finish = function(cleanup){
                  if (record.disposed || record.runVersion !== runVersion) {
                    if (typeof cleanup === 'function') {
                      try {
                        cleanup();
                      } catch (error) {
                        console.error('HTMS effect cleanup failed:', error);
                      }
                    }
                    return;
                  }
                  record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
                  record.initialized = true;
                };
                try {
                  const result = record.run();
                  if (result && typeof result.then === 'function') {
                    result
                      .then(resolved => {
                        finish(typeof resolved === 'function' ? resolved : nextCleanup);
                      })
                      .catch(error => {
                        console.error('HTMS effect promise rejected:', error);
                      });
                    return;
                  }
                  if (typeof result === 'function') {
                    nextCleanup = result;
                  }
                } catch (error) {
                  console.error('HTMS effect execution failed:', error);
                }
                finish(nextCleanup);
              }
            };
            index.set(spec.id, record);
            if (this.flushingEffects || this.effectMutationDepth > 0) {
              this.pendingEffects.push(record);
            } else {
              this.effects.push(record);
            }
          } else {
            record.depsFns = deps;
            record.run = typeof spec.run === 'function' ? spec.run : record.run;
            record.cleanupFactory = typeof spec.cleanup === 'function' ? spec.cleanup : record.cleanupFactory;
            record.once = !!spec.once;
            // Re-registration happens on every render. \`immediate\` only
            // governs the first run; afterwards the effect re-runs when its
            // dependencies change (or on every flush when it has none).
          }
          this.scheduleFlush();
          return {
            dispose: function(){
              record.dispose();
            }
          };
        },
        keyedList: function(sel, arr, render, keyFn){
          const container = document.querySelector(sel);
          if (!container) {
            console.warn('KEYEDLIST target not found:', sel);
            return;
          }
          const existing = new Map();
          Array.from(container.children).forEach(function(node){
            if (node && typeof node.getAttribute === 'function') {
              const key = node.getAttribute('data-key');
              if (key != null) {
                existing.set(key, node);
              }
            }
          });
          const used = new Set();
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            const key = String(keyFn(item, i));
            let node = existing.get(key);
            if (!node) {
              node = render(item, i);
              if (node && typeof node.setAttribute === 'function') {
                node.setAttribute('data-key', key);
              }
            }
            if (node) {
              container.appendChild(node);
              used.add(key);
            }
          }
          existing.forEach(function(node, key){
            if (!used.has(key) && node && node.parentNode === container) {
              container.removeChild(node);
            }
          });
        },
        disposeEffectsFor: function(owner){
          if (!owner) {
            return;
          }
          // Most disconnected components never owned an effect. The index
          // answers that without scanning other components' live records.
          // Still compact records disposed through handles since the last
          // flush, even when this owner has no remaining indexed effects.
          const index = this.effectIndex(owner, false);
          if ((!index || index.size === 0) && !this.effectsNeedCompaction) {
            return;
          }
          // Cleanup can register or dispose effects. Snapshot this owner's
          // records so newly registered effects survive this disposal pass.
          const owned = index ? Array.from(index.values()) : [];
          this.effectMutationDepth++;
          try {
            for (let i = 0; i < owned.length; i++) {
              owned[i].dispose();
            }
            if (!this.flushingEffects && this.effectMutationDepth === 1) {
              this.compactEffects(this.effects);
            }
          } finally {
            this.effectMutationDepth--;
            this.commitPendingEffects();
          }
        }
      };
      Object.defineProperty(window, '__htms', {
        value: runtime,
        configurable: false,
        enumerable: false,
        writable: false
      });
    }
  })();`;
}
