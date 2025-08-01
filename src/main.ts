#!/usr/bin/env node

// Re-export CLI for backwards compatibility
export * from './cli';

// If run directly, execute CLI
if (require.main === module) {
  require('./cli');
}