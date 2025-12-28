#!/usr/bin/env node

// Re-export CLI for backwards compatibility
export * from './cli';

// Export parser
export * from './parser';

// Export SSR utilities
export * from './ssr';

// Export types
export * from './types';

// If run directly, execute CLI
if (require.main === module) {
  require('./cli');
}