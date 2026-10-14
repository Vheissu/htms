import * as nodeModule from 'node:module';

// Node can keep the compiled bytecode of every module the CLI loads in its
// on-disk cache, so later runs skip compiling the compiler and its parsers
// (about 10% of a CLI invocation). The API arrived in Node 22.1; older
// runtimes just compile each time. This module must be imported before any
// module worth caching.
const enableCompileCache = (
  nodeModule as { enableCompileCache?: () => unknown }
).enableCompileCache;
if (typeof enableCompileCache === 'function') {
  try {
    enableCompileCache();
  } catch {
    // A read-only or unavailable cache directory is not an error for the CLI.
  }
}
