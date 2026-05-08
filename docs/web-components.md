# HTMS Web Component Architecture

## Goals

- Let authors declare Custom Elements using pure HTMS markup (HTML + HTMS control tags).
- Generate standards-compliant classes (`customElements.define`) without a runtime.
- Preserve existing tag semantics (state, control flow, DOM updates) but scope them to a component instance and its shadow DOM.
- Keep injection points for security validation; no inline scripts or dynamic evaluation.
- Provide a path for co-existence with the current DOM-imperative compiler during migration.

## Component Declaration

```html
<component name="todo-app" shadow="open" props="items, filter" observed="items">
  <!-- template + HTMS control tags -->
</component>
```

| Attribute  | Required | Description                                                                             |
| ---------- | -------- | --------------------------------------------------------------------------------------- |
| `name`     | ✅       | Custom element tag name (must include a hyphen). Maps to the registered tag.            |
| `shadow`   | ❌       | `open`, `closed`, or `none` (default: `open`). Determines `attachShadow` behavior.      |
| `props`    | ❌       | Comma-separated list of public reactive properties initialized on the instance.         |
| `observed` | ❌       | Comma-separated list of attributes reflected through `static get observedAttributes()`. |

Fallback behavior: if `shadow="none"`, markup is stamped into the light DOM; otherwise it renders inside a shadow root.

### Inputs & Attribute Reflection

`props` now emits real JavaScript property accessors, not one-off constructor assignments. Each prop:

- initializes from its matching kebab-case attribute (`labelText` reads `label-text`);
- defaults to `null` when no attribute is present;
- re-renders the component when assigned after `connectedCallback`.

Attributes listed in `observed` are emitted from `static get observedAttributes()` and reflected into component properties. If an observed attribute matches a prop name or a prop's kebab-case form, that prop is updated. Otherwise the compiler maps the attribute to a camel-cased property name.

```html
<component name="user-badge" props="labelText" observed="label-text">
  <span id="label"></span>
  <bind selector="#label" prop="textContent" expr="this.labelText"></bind>
</component>
```

```js
const badge = document.createElement('user-badge');
badge.setAttribute('label-text', 'Ready');
document.body.appendChild(badge);
badge.labelText = 'Synced';
```

## Template Semantics

- Native HTML inside `<component>` becomes inert template markup (no direct `document.createElement` calls). The compiler serializes the template DOM, sanitizes with `SecurityValidator`, and stores it in a `<template>` node.
- `<slot>` tags pass through to enable composition; arbitrary text nodes are preserved.
- Component root defaults to `<template>` content; outer `<component>` is not emitted.
- Text and attribute values in normal component markup can interpolate reactive component fields and props with `{count}`, `{user.name}`, and `{labelText}`. Simple names are resolved against the component instance.
- Text and attribute values inside component-mode `<repeat>` templates can interpolate the active item, item property paths, and optional index with `{item}`, `{item.name}`, and `{indexName}` tokens.
- Array repeats treat `null` and non-array values as empty lists so components can render safely before async data or property inputs arrive.

## Lifecycle Mapping

| Lifecycle hook             | Trigger                   | Generated HTMS features                                   |
| -------------------------- | ------------------------- | --------------------------------------------------------- |
| `constructor`              | Element creation          | Initializes state from `<var>` tags with `scope="class"`. |
| `connectedCallback`        | Element inserted          | Runs compiled body (default append template + bindings).  |
| `disconnectedCallback`     | Element removed           | Disposes runtime effects owned by the component.          |
| `attributeChangedCallback` | Observed attribute change | Bridges attributes to properties; invokes bindings.       |

### State & Reactivity

- `<var>` tags with `scope="instance"` declare reactive fields. Compiler emits property definitions and update notifications.
- `<set>`, `<push>`, `<splice>` operate on instance fields and trigger `render()` cycle (virtual method the compiler injects).
- `render()` clones the template and applies control-flow transformations (`REPEAT`, `IF/ELSE`, etc.).

### Events & Handlers

- `<event target="#btn" type="click">` attaches listeners within the component’s shadow tree. Handlers execute HTMS child tags with `this` bound to the component instance.
- `<submit>` reuses event semantics with `preventDefault` injected automatically.
- `<effect>` and `<fetch>` register component-owned runtime effects. Generated components dispose those effects immediately when disconnected, including cleanup callbacks and in-flight fetch abort handlers.

## Control Flow Translation

- `<repeat>` compiles to loops that rebuild fragments under the owning element during `render()`.
- `<if>` / `<else>` generate conditional blocks that toggle DOM nodes within the shadow root (no global document access).
- `<print type="log">` and similar imperative tags run within component methods, with console access sandboxed via `SecurityValidator`.

## Compilation Phases

1. **Parse**: JSDOM builds DOM tree; validation rejects unsafe patterns.
2. **IR Build**: Convert HTMS DOM into an intermediate representation:
   - `ComponentIR`: metadata + template tree + behaviour graph.
   - `TemplateIR`: serializable DOM fragments and directives.
   - `BehaviorIR`: imperative actions (state init, events, control flow).
3. **Generate**: Emit TypeScript/JavaScript class strings using Escodegen, wrap in module format (ESM/CJS/IIFE).
4. **Security Audit**: Traverse emitted AST with existing security checks.

## Migration Strategy

- `ParseOptions.mode`: `dom` (default) keeps legacy output; `component` switches to new pipeline.
- CLI gains `--mode component`. Tests run both pipelines during rollout.
- Existing tag handlers adapt to produce IR nodes; old string-returning root functions continue until consumers switch.

## Using Component Mode Today

- Build the compiler and emit component-ready bundles:

  ```bash
  npm run build
  node dist/cli.js compile demos/hello-world-component.html --mode component --output demos/hello-world-component.js
  ```

- Install Playwright’s browser binaries once per machine:

  ```bash
  npx playwright install chromium
  ```

- Run browser smoke tests against the generated components:

  ```bash
  npm run test:e2e
  ```

## Reference Demos

- `demos/hello-world-component.html` – basic shadow DOM rendering.
- `demos/event-toggle-component.html` – button click drives attribute and visibility directives.
- `demos/bind-component.html` – compile-time bindings hydrate text content during render.
- `demos/counter-component.html` – demonstrates `<var>`, `<set>`, and `<bind>` working together with re-rendering.

## Open Questions

- How to expose slots/props type information for TypeScript declarations?
- Best strategy for granular updates (diffing) vs. full re-render on state changes.
- Opt-in runtime helpers (e.g., `createReactiveField`) vs. inline generated code trade-offs.
