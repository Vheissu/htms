export function ensureRuntime(): string {
  return `(function(){
    if (typeof window === 'undefined') return;
    if (!window.__htms) {
      const runtime = {
        watchers: [],
        effects: [],
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
              const el = document.querySelector(watcher.sel);
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
          this.effects = this.effects.filter(effect => {
            if (effect.disposed) {
              return false;
            }
            if (effect.owner && !effect.owner.isConnected) {
              effect.dispose();
              return false;
            }
            const values = [];
            let shouldRun = effect.dirty || effect.depsFns.length === 0;
            for (let i = 0; i < effect.depsFns.length; i++) {
              let value;
              try {
                value = effect.depsFns[i]();
              } catch (error) {
                console.error('HTMS effect dependency failed:', error);
                value = undefined;
              }
              values.push(value);
              if (!shouldRun && (i >= effect.lastValues.length || effect.lastValues[i] !== value)) {
                shouldRun = true;
              }
            }
            effect.lastValues = values;
            if (effect.skipInitial && !effect.initialized) {
              effect.skipInitial = false;
              effect.dirty = false;
              effect.initialized = true;
              return !effect.disposed;
            }
            if (shouldRun) {
              effect.dirty = false;
              effect.execute();
              effect.initialized = true;
              if (effect.once) {
                effect.dispose();
                return false;
              }
            }
            return !effect.disposed;
          });
        },
        bind: function(sel, prop, fn){
          const watcher = { sel, prop, fn, disposed: false, autoDispose: true };
          this.watchers.push(watcher);
          try {
            const el = document.querySelector(sel);
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
          let record = this.effects.find(effect => effect.owner === owner && effect.id === spec.id);
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
              dispose: function(){
                if (record.disposed) {
                  return;
                }
                record.disposed = true;
                if (typeof record.cleanup === 'function') {
                  try {
                    record.cleanup();
                  } catch (error) {
                    console.error('HTMS effect cleanup failed:', error);
                  }
                }
                record.cleanup = undefined;
                record.initialized = false;
                record.skipInitial = false;
              },
              execute: function(){
                if (record.disposed) {
                  return;
                }
                if (typeof record.cleanup === 'function') {
                  try {
                    record.cleanup();
                  } catch (error) {
                    console.error('HTMS effect cleanup failed:', error);
                  }
                  record.cleanup = undefined;
                }
                let nextCleanup = record.cleanupFactory;
                try {
                  const result = record.run();
                  if (result && typeof result.then === 'function') {
                    record.initialized = true;
                    result
                      .then(resolved => {
                        if (typeof resolved === 'function') {
                          record.cleanup = resolved;
                        } else if (typeof nextCleanup === 'function') {
                          record.cleanup = nextCleanup;
                        }
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
                record.cleanup = typeof nextCleanup === 'function' ? nextCleanup : undefined;
                record.initialized = true;
              }
            };
            this.effects.push(record);
          } else {
            record.depsFns = deps;
            record.run = typeof spec.run === 'function' ? spec.run : record.run;
            record.cleanupFactory = typeof spec.cleanup === 'function' ? spec.cleanup : record.cleanupFactory;
            record.once = !!spec.once;
            record.disposed = false;
            if (spec.immediate !== false && !record.initialized) {
              record.dirty = true;
            }
            if (spec.immediate === false && !record.initialized) {
              record.skipInitial = true;
            } else if (spec.immediate !== false) {
              record.skipInitial = false;
            }
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
          this.effects = this.effects.filter(effect => {
            if (effect.owner === owner) {
              effect.dispose();
              return false;
            }
            return true;
          });
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
