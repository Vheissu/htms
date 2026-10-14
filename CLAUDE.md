# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HTMS (Hyper Text Media Script) is a secure HTML-to-JavaScript compiler that allows writing JavaScript logic using custom HTML tags. The project has been completely refactored for production readiness with comprehensive security, error handling, and validation.

## Core Architecture

The compilation pipeline consists of three main stages:

1. **HTML Parsing** (`component/source-parser.ts`, `source-dom.ts`): parse5 builds a light DOM-like tree (`SourceElement`, `SourceNode`, ...) with source locations; jsdom is only loaded for server rendering
2. **Element Processing** (`handlers.ts`): Routes custom tags to specific handlers in the `tags/` directory
3. **Code Generation** (`parser.ts:generateFinalJsCode`): Uses meriyah (via `utils/js-parser.ts`) and escodegen to validate and generate clean JavaScript output

Components compile to "blocks" (`component/block-compiler.ts`): a cloned template plus an update method per block. `component/dependencies.ts` gives every field a dirty bit and derives, from the expressions and method bodies, which fields each binding reads and which fields each handler or method writes in place; the update method skips bindings whose fields did not change, and a field nothing renders never schedules a render. Fields that may share objects (`editing = todo`) form alias classes so an in-place write through one marks the others.

### Key Components

- `cli.ts`: CLI entry point that reads HTML files and outputs generated JS
- `parser.ts`: Core parsing logic and compilation pipeline
- `handlers.ts`: Element routing system with mapping of custom tags to handler functions
- `html-element.ts`: Handles standard HTML elements vs custom HTMS tags
- `tags/`: Directory containing individual tag handlers (array, function, if-else, print, etc.)

### Custom Tag System

The project supports custom HTML tags that compile to JavaScript:

- `<print>`: Generates console.log statements
- `<var>`: Variable declarations
- `<function>`: Function definitions
- `<if>/<else>`: Conditional logic
- `<repeat>`: Loop constructs
- `<array>`: Array creation
- `<object>`: Object literals
- `<event>`: Event handling
- Plus others in the `tags/` directory

## Development Commands

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
npm run test:watch
npm run test:coverage

# Linting and formatting
npm run lint
npm run lint:fix
npm run format
npm run type-check

# Compile HTMS files
npm run compile <input.html>
# Or after building:
node dist/cli.js compile <input.html>

# Examples:
node dist/cli.js compile demos/hello-world-component.html
node dist/cli.js compile demos/hello-world-component.html --strict
node dist/cli.js compile demos/hello-world-component.html -o output.js --format cjs

# Validate files without compilation
node dist/cli.js validate <input.html>
```

## Security Features

- **Input Validation**: All user input is validated and sanitized
- **Code Injection Prevention**: Dangerous patterns like `eval()`, `Function()` are blocked
- **Path Traversal Protection**: File system access is restricted
- **Strict Mode**: Enhanced security controls for production environments
- **Comprehensive Logging**: All security issues are logged with context
- **Whitelisted Functions**: Only safe functions allowed in strict mode

## Testing

- Uses Jest with ts-jest preset
- Custom Jest environment configuration in `jest-environment-config.cjs`
- Test files located in `tests/` directory
- Tests cover both individual tag handlers and the core parser functionality

## File Structure

- Root level contains core compilation logic
- `demos/` contains example HTMS files showcasing different features
- `tags/` contains modular tag handlers
- `tests/` contains Jest test files
- Generated JavaScript files are output alongside their source HTML files
