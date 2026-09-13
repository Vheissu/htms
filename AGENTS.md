# Repository Guidelines

## Project Structure & Module Organization

- Source: `src/` holds the maintained TypeScript code — `parser.ts` (HTML→JS pipeline), `cli.ts` (CLI), `handlers.ts`, `html-element.ts`, `tags/`, `utils/`, `types.ts`. Build output goes to `dist/`. Demos live in `demos/`. Tests are in `tests/`.
- Legacy prototypes: some root-level `*.ts` files and `tags/` exist for older demos/tests. Prefer editing `src/**`. If behavior changes, update tests (and legacy files if still referenced).

## Build, Test, and Development Commands

- `npm ci`: install dependencies cleanly.
- `npm run build`: compile TypeScript to `dist/` (tsc).
- `npm test` | `npm run test:watch` | `npm run test:coverage`: run Jest.
- `npm run type-check`: TS type checks without emit.
- `npm run lint` | `npm run lint:fix`: ESLint with security rules.
- `npm run format`: Prettier formatting.
- Run locally:
  - Quick demo: `npm run compile -- demos/hello-world-component.html` (uses `src/cli.ts`).
  - Built CLI: `npm run build && node dist/cli.js compile demos/hello-world-component.html -o demos/hello-world-component.js --format esm --strict`.

## Coding Style & Naming Conventions

- TypeScript strict mode; 2‑space indent; single quotes; semicolons; 80‑col wrap (see `.prettierrc`).
- ESLint (`.eslintrc.js`): no `any`, no unused vars, explicit returns (warn), `eslint-plugin-security` enabled.
- Naming: files kebab-case (`html-element.ts`), types/interfaces PascalCase, functions/vars camelCase.

## Testing Guidelines

- Framework: Jest + ts-jest + JSDOM environment.
- Test files: `tests/<name>.spec.ts`.
- Cover parser and tag handlers with focused unit tests; keep tests deterministic. Use `npm run test:coverage` before PRs.

## Commit & Pull Request Guidelines

- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `chore: …`. Example: `feat(core): enforce secure attribute validation`.
- PRs must include: clear description, linked issues, new/updated tests, and (if CLI or output changes) a demo command and resulting snippet.
- Pre-submit checklist: `npm run lint && npm run type-check && npm test` (all green).

## Security & Configuration Tips

- Avoid dynamic code execution (`eval`, `Function`). Use `SecurityValidator`; validate files with `htms validate <file>`.
- Logs: console output via `LOG_LEVEL=debug`; file logging is opt-in via `HTMS_LOG_DIR=<dir>` (writes `htms-combined.log`, `htms-error.log` there).
