# HTMS Web Component Architecture

## Goals

- Let authors declare Custom Elements using pure HTMS markup (HTML + HTMS control tags).
- Generate standards-compliant classes with `customElements.define`. Runtime-backed effects share one bootstrap per bundle and are omitted when unused.
- Preserve existing tag semantics (state, control flow, DOM updates) but scope them to a component instance and its shadow DOM.
- Render the same component source on the server and adopt that DOM in the browser.
- Describe generated component properties and events to TypeScript consumers.
- Keep injection points for security validation; no inline scripts or dynamic evaluation.
- Provide a path for co-existence with the current DOM-imperative compiler during migration.

## Component Declaration

```html
<component name="todo-app" shadow="open" props="items, filter" observed="items">
  <!-- template + HTMS control tags -->
</component>
```

| Attribute  | Required | Description                                                                                                                             |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | ✅       | Custom element tag name (must include a hyphen). Maps to the registered tag.                                                            |
| `shadow`   | ❌       | `open`, `closed`, or `none` (default: `open`). Determines `attachShadow` behavior.                                                      |
| `props`    | ❌       | Comma-separated reactive properties. Types are written as `count:number`, `active:boolean`, or `options:json`; the default is `string`. |
| `observed` | ❌       | Extra attributes to expose as camel-cased string properties. Declared props are observed automatically.                                 |

Fallback behavior: if `shadow="none"`, markup is stamped into the light DOM; otherwise it renders inside a shadow root.

### Inputs & Attribute Reflection

`props` now emits real JavaScript property accessors, not one-off constructor assignments. Each prop:

- initializes from its matching kebab-case attribute (`labelText` reads `label-text`);
- defaults to `null` when no attribute is present;
- re-renders the component when assigned after `connectedCallback`.

Declared props are emitted from `static get observedAttributes()` and keep following their matching attributes after connection. Number props use finite JavaScript numbers, boolean props use attribute presence, and JSON props are parsed objects or arrays. Invalid number or JSON input becomes `null` instead of throwing during an attribute callback.

Attributes listed in `observed` are added to the same callback. If an observed attribute doesn't match a prop, the compiler maps it to a camel-cased string property.

```html
<component name="user-badge" props="labelText" observed="label-text">
  <span id="label"></span>
  <bind selector="#label" prop="textContent" expr="this.labelText"></bind>
</component>
```

## Module formats

- ESM emits one export list for every class in the source file.
- CommonJS assigns the classes to `module.exports` and contains no ESM syntax.
- IIFE output registers each custom element and stores its class on `globalThis.HTMSComponents`.

```js
const badge = document.createElement('user-badge');
badge.setAttribute('label-text', 'Ready');
document.body.appendChild(badge);
badge.labelText = 'Synced';
```

## Template Semantics

- Native HTML inside `<component>` becomes inert template markup (no direct `document.createElement` calls). The compiler serializes the template DOM, sanitizes with `SecurityValidator`, and stores it in a `<template>` node.
- `<slot>` tags pass through to enable composition; arbitrary text nodes are preserved.
- Compiled custom elements can be nested directly. Unknown non-hyphenated tags still fail validation, which catches most misspelled HTML and HTMS tags.
- Native HTML is not limited to a small allowlist. SVG and MathML nodes retain their namespaces when interpolation requires programmatic node creation.
- Template attributes are checked recursively. Unsafe event attributes and executable URL schemes are removed in normal mode and stop compilation in strict mode.
- Component root defaults to `<template>` content; outer `<component>` is not emitted.
- Text and attribute values in normal component markup can interpolate expressions over component fields and props: `{count}`, `{user.name}`, `{items.length > 0 ? 'Some' : 'None'}`. Field names are resolved against the component instance, and paths are null-safe.
- Markup elements accept inline directive attributes: `on:<event>[.modifiers]` (or `@<event>`), `bind:value`/`bind:checked`, `class:<name>`, `style:<property>` and `if`. See the README for the full table.
- Text and attribute values inside component-mode `<repeat>` templates can interpolate the active item, item property paths, and optional index with `{item}`, `{item.name}`, and `{indexName}` tokens.
- Array repeats treat `null` and non-array values as empty lists so components can render safely before async data or property inputs arrive.

## Lifecycle Mapping

| Lifecycle hook             | Trigger                   | Generated HTMS features                                   |
| -------------------------- | ------------------------- | --------------------------------------------------------- |
| `constructor`              | Element creation          | Defines reactive accessors for props and `<var>` state.   |
| `connectedCallback`        | Element inserted          | Initializes state and renders the template + bindings.    |
| `disconnectedCallback`     | Element removed           | Disposes runtime effects owned by the component.          |
| `attributeChangedCallback` | Observed attribute change | Bridges attributes to properties; invokes bindings.       |

### State & Reactivity

- `<var>` tags declare reactive fields. Compiler emits property definitions and update notifications. `<object>` and `<array>` declare state from child tags.
- Expressions name fields directly (`count`, `todos.length`); the compiler resolves them to `this.<field>`. Loop variables, `event`, declared locals and globals are left alone.
- `<function>` compiles to a class method that can be called from expressions, handlers and outside code. The component re-renders after a method returns.
- `<derive name="total" expr="items.length">` updates derived fields before templates and bindings run. The block renderer skips calculations it recognizes as pure when their dependencies haven't changed. Derived chains, nested writes and replacement of a target object invalidate the affected values. Unknown or side-effectful calculations stay eager, and `requestUpdate()` forces recomputation. The legacy renderer recomputes on each render.
- `<set>`, `<push>`, and `<splice>` update instance fields and schedule a render.
- Prop and top-level state writes are batched in a microtask. Several synchronous writes produce one render.
- Generated elements expose `requestUpdate()` for in-place nested changes and an `updateComplete` promise for code that needs the updated DOM.
- Renders preserve focus, selection, scroll position, and unfinished values in uncontrolled form elements. Controlled fields still follow their bound component state.
- The first `render()` clones the component's static template and records the nodes that can change. Later renders call the generated update method, which re-evaluates each interpolation, binding and directive value and writes to the DOM only when the value differs from the last render.
- Loops (`REPEAT`, `KEYEDLIST`) and branches (`IF/ELSE`, `SWITCH`) are nested blocks with their own templates. Unkeyed loops reuse rows by position; keyed loops (`key="row.id"`) match rows by key and move them with a longest-increasing-subsequence pass. `KEYEDLIST` rows also carry their key as `data-key`.
- Selector directives (`<event target>`, `<bind>`, `<setattr>`, `<toggle>`, `<class>`, `<style selector>`, `<append>`) are resolved against the template at compile time. A component whose selectors could match markup created by a loop or branch, or that uses `<while>`, falls back to the reconciling renderer: `render()` builds a detached fragment and reconciles it with the current DOM, matching keyed children by `data-key`.
- Bubbling events (`click`, `input`, `change`, `keydown` and similar) use one listener per type on the render root. `event.currentTarget` is the element the handler was declared on, and `.stop` stops handlers on enclosing elements.
- A failed render is stored in `renderError` and reported through a cancelable `htms-error` event that bubbles across the shadow boundary.

### Events & Handlers

- `<event target="#btn" type="click">` attaches listeners within the component’s shadow tree. Handlers execute HTMS child tags, in document order, with `this` bound to the component instance. `target="window"`, `"document"` and `":host"` listen outside the shadow tree for the lifetime of the element.
- `on:click="..."` on an element is the inline form. Handlers re-render the component afterwards; `once` and `debounce` state survives re-renders.
- `<submit>` reuses event semantics with `preventDefault` injected automatically.
- `<effect>` and `<fetch>` register component-owned runtime effects. An effect runs once (unless `immediate="false"`) and then whenever one of its `deps` changes; an effect without deps runs after every render. Generated components dispose those effects immediately when disconnected, including cleanup callbacks and in-flight fetch abort handlers. A superseded fetch never overwrites the state of the request that replaced it.
- Multiple effects and fetches in the same source share one runtime bootstrap, reducing parse and bundle overhead.

## Control Flow Translation

- `<repeat>` compiles to a list block under the owning element. Rows are created once and updated in place; `key` makes reorders move rows instead of rewriting them.
- `<keyedlist>` targets a container inside the component root, renders item templates with item/index interpolation, preserves DOM nodes for matching keys across updates, and scopes item events to each generated fragment.
- `<if>` / `<else>` generate conditional blocks that toggle DOM nodes within the shadow root (no global document access).
- `<print type="log">` and similar imperative tags run within component methods, with console access sandboxed via `SecurityValidator`.
- `<emit>` compiles to `this.dispatchEvent(new CustomEvent(...))`, letting a component notify its host. It defaults to `composed: true` so the event escapes the shadow root, and runs inside the enclosing handler so it can forward freshly-updated state via `detail`.
- Registration checks `customElements.get()` before defining a tag, so loading the same compiled bundle twice does not throw. Duplicate names in one HTMS source file are compile errors.

Keyed list rows with a class toggle such as `class:active="row.id === selected"`
can use a lazy key lookup when the comparison matches the list's key.
After the first selection, changing `selected` updates the previous and new
matching rows. Structural updates and deep writes invalidate the lookup.
Duplicate keys and rows with other component-dependent bindings retain the
general update path. The first lookup costs a pass over the rows and retains
a map until the list changes.

## Compilation Phases

1. **Parse**: parse5 builds the source tree; validation rejects unsafe patterns.
2. **IR Build**: Convert HTMS DOM into an intermediate representation:
   - `ComponentIR`: metadata + template tree + behaviour graph.
   - `TemplateIR`: serializable DOM fragments and directives.
   - `BehaviorIR`: imperative actions (state init, events, control flow).
3. **Generate**: Emit JavaScript classes, a module wrapper (ESM/CJS/IIFE), and a TypeScript declaration file.
4. **Security Audit**: Traverse emitted AST with existing security checks.

## Compiler contract

- Component mode is the supported compiler pipeline and the default for `parseHTML`.
- Every source root must be a `<component>` element. Legacy top-level DOM compilation returns a validation error.
- One source file can declare several components. The compiler rejects duplicate element names and JavaScript class-name collisions before emitting code.

## Using Component Mode Today

- Build the compiler and emit component-ready bundles:

  ```bash
  npm run build
  node dist/cli.js compile demos/hello-world-component.html --mode component --output demos/hello-world-component.js
  ```

  This also writes `demos/hello-world-component.d.ts`. Pass `--no-declarations` if the declaration is not needed.

- Render a component on the server:

  ```bash
  node dist/cli.js render demos/ssr-card-component.html \
    --props '{"name":"Ada","count":3}' \
    --output demos/ssr-card-component.ssr.html
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
- `demos/composition-component.html` – nests one compiled component inside another and fills named/default slots.
- `demos/ssr-card-component.html` – accepts typed server props and remains interactive after hydration.

## Server rendering and hydration

`renderToString(source, options)` compiles one component in IIFE mode inside an isolated JSDOM window. It returns the rendered component, compiler artifact, client bundle, and a versioned hydration manifest. Open and closed shadow roots are serialized as Declarative Shadow DOM. Components with `shadow="none"` are serialized as light DOM.

Set `hydrationId` in the API, or `--id` in the CLI, when a page renders more than one top-level HTMS component. Nested compiled components are serialized recursively, including their own declarative shadow roots.

Effects and fetches do not run during server rendering. They register normally when the client bundle upgrades the element.

```ts
import { hydrate, renderToString } from 'htms';

const rendered = renderToString(source, {
  tagName: 'ssr-card',
  props: { name: 'Ada', count: 3 },
});

// Send rendered.html in the HTTP response. In the browser, load the compiled
// component bundle first, then apply serialized JavaScript properties.
await hydrate(document);
```

Browsers that support Declarative Shadow DOM expose the server tree immediately. The generated component also adopts the fallback `<template shadowrootmode>` representation used by JSDOM and older HTML parsers. Hydration reconciles the first client render with that tree instead of clearing it.

Closed declarative shadow roots remain intentionally inaccessible through `element.shadowRoot`, as required by the platform. HTMS keeps its internal root reference so later renders still work.

## TypeScript declarations

`htms compile` writes a sibling `.d.ts` file by default. It includes:

- the generated custom element class;
- typed public props (`string`, `number`, `boolean`, and `json`);
- `requestUpdate`, `updateComplete`, and `renderError`;
- typed overloads for events declared with `<emit>` and for `htms-error`;
- native event types and matching `removeEventListener` overloads;
- HTML and SVG tag inference for `$` and `$$`, plus explicit element types;
- an `HTMLElementTagNameMap` entry for each component in the source file.

```ts
const card = document.createElement('user-badge');
const button = card.$('button'); // HTMLButtonElement | null
const circle = card.$('circle'); // SVGCircleElement | null
const input = card.$<HTMLInputElement>('#name');
card.addEventListener('click', event => console.log(event.clientX));
```

## Platform requirements

Client components require Custom Elements, Shadow DOM, template elements, `queueMicrotask`, and ES2015 collections. Declarative Shadow DOM improves first paint but is not required for client-only rendering or fallback-template hydration.
