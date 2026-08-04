# HTMS

Write JavaScript with HTML. Yes, on purpose.

HTMS (Hyper Text Media Script) compiles HTML-flavoured source into reactive web components. The syntax borrows the good bit from ColdFusion: state, loops and events are tags too. The output is regular JavaScript built on Custom Elements, Shadow DOM and DOM events.

```html
<component name="click-counter">
  <var name="count" value="0" mutable="true"></var>

  <button id="increment">Clicked {count} times</button>

  <event target="#increment" type="click">
    <set name="count" op="++"></set>
  </event>
</component>
```

No `eval`, no `Function` constructor and no private browser runtime to learn.

## Try it from this repo

The current toolchain requires Node 20.19 or newer.

```bash
npm ci
npm run build
npm run htms -- create click-counter
npm run htms -- dev click-counter.html
```

Open `http://127.0.0.1:5173/`, click the button, then edit the HTML. The browser reloads after a clean compile. If you misspell a tag or forget an attribute, the error appears in the preview and the terminal with the source line and a suggested fix.

The starter is deliberately small enough to pull apart. HTMS won't replace an existing file unless you pass `--force`.

[Try the live component demos](https://vheissu.github.io/htms/), read the
[getting-started guide](https://github.com/Vheissu/htms/blob/master/docs/getting-started.md),
or run `npm run demo:serve` and open `http://localhost:5173/demos/`.

## CLI

- `htms create <name>` makes an interactive starter. `htms new` is an alias.
- `htms dev <file>` compiles, serves a preview and reloads it on save.
- `htms validate <file>` runs the real compiler without writing output.
- `htms compile <file>` writes JavaScript and a sibling TypeScript declaration.
- `htms watch <file>` recompiles without starting a server.
- `htms render <file>` produces server-rendered Declarative Shadow DOM.

Run `htms <command> --help` for every option. If a file declares several components, pass `--tag <name>` to `dev` or `render`.

## Component Inputs

`<component>` can expose browser-native custom element inputs:

```html
<component
  name="user-badge"
  props="labelText, count:number, active:boolean, options:json"
>
  <span id="label"></span>
  <bind selector="#label" prop="textContent" expr="this.labelText"></bind>
</component>
```

- `props` creates public properties with reactive setters. A prop is a string unless its name ends with `:number`, `:boolean`, or `:json`.
- Props initialize from their matching kebab-case attributes (`labelText` reads `label-text`) and default to `null` when no attribute is present.
- Declared props automatically observe their matching attributes. Boolean props use attribute presence, invalid numbers and JSON become `null`, and a missing boolean attribute becomes `false`.
- `observed` can list extra attributes that aren't declared as props. Those are exposed as camel-cased string properties.

## Output formats

`--format esm` exports all generated classes in one ESM export list. `--format cjs` writes them to `module.exports`. `--format iife` registers the elements immediately and exposes the classes on `globalThis.HTMSComponents`.

Every format also gets a `.d.ts` file describing component props, emitted events, update lifecycle, and `HTMLElementTagNameMap` entries.

## Component updates

Prop changes and top-level state changes are batched into one render per microtask. An event handler can update several fields without rebuilding the component after every write.

Every generated component has `requestUpdate()` and `updateComplete`:

```js
counter.count = 2;
counter.count = 3;
await counter.updateComplete;
```

The DOM now contains the state for `3`, after one render. Assigning a new value to a field declared with `<var>` schedules an update. JavaScript can't observe an in-place nested mutation such as `counter.items.push(value)`, so call `counter.requestUpdate()` after that kind of change. HTMS `<push>` and `<splice>` do this automatically.

Reactive renders reconcile a detached fragment with the current DOM. Compatible non-keyed elements keep their identity, while keyed children can move without being recreated. This also preserves keyboard focus, text selection, scroll position, and unfinished values in uncontrolled form fields. Fields managed by `<bind>`, `<model>`, or `<setprop>` continue to use their component state as the source of truth.

If a render fails, the component stores the error in `renderError` and emits a bubbling, composed `htms-error` event. Call `event.preventDefault()` after handling the error to suppress the default console report.

## Server rendering and hydration

The server API renders compiled components in an isolated JSDOM document and returns Declarative Shadow DOM plus a JSON hydration manifest:

```ts
import { renderToString } from 'htms';

const { html } = renderToString(source, {
  tagName: 'user-badge',
  props: { labelText: 'Ready', count: 2 },
});
```

The CLI exposes the same path:

```bash
htms render component.html \
  --props '{"labelText":"Ready","count":2}' \
  --attributes '{"class":"compact"}' \
  --output component.ssr.html
```

`<effect>` and `<fetch>` stay dormant on the server. In the browser, load the compiled component bundle and call `hydrate()` from the package. The first client render adopts and reconciles the server tree, including a fallback for parsers that leave Declarative Shadow DOM as a template.

## How It Works (roughly)

- Parses HTMS markup with JSDOM, converts nodes to directives via tag handlers, validates with Esprima, then emits JavaScript through Escodegen.
- A security pass rejects dangerous constructs (`eval`, inline handlers, raw `innerHTML`, path traversal, …).
- In component mode, standard elements become cached template fragments, while control/state tags compile into instructions that mutate the component instance and re-render the shadow DOM.
- Component text and attributes can interpolate reactive state and props with `{count}`, `{user.name}`, and `{labelText}`.
- Components compose through normal custom elements and browser slots. Dynamic SVG and MathML nodes keep their namespaces.
- Component-owned runtime effects are disposed in `disconnectedCallback`, so cleanup handlers and fetch aborts run when elements leave the page.
- Effect and fetch helpers share one runtime bootstrap per generated bundle. Components that do not use runtime-backed directives do not include it.
- Server and client rendering use the same component compiler and reconciliation code.

## Tag glossary

- State & Arrays
  - `<var name="x" value="42" mutable="true" />` — declare `let x = 42` (accepts JSON).
  - `<derive name="total" expr="this.items.length" />` — compute reactive state before each render.
  - `<set name="x" op="=|+=|-=|*=|/=|++|--" value="…" />` — mutate values; notifies bindings.
  - `<push array="state.list" expr="document.getElementById('txt').value" />` — push; notifies bindings.
  - `<splice array="state.list" index="0" delete="1" values='["New"]' />` — remove/insert; notifies bindings.
- Control Flow
  - `<repeat variable="items" index="i">…</repeat>` or `<repeat count="3">…</repeat>` — inside, use `{item}`, property paths like `{item.name}`, and the optional index token (`{i}` here) in text or attribute values.
  - `<if condition="flag">…</if><else-if condition="other">…</else-if><else>…</else>` — nested tags allowed.
  - `<while condition="state.count < 3" max="1000">…</while>` — guarded loop; `max` prevents infinite loops.
  - `<switch variable="day">…</switch>` or `<switch expr="this.day">…</switch>` — nested tags allowed.
- DOM Updates
  - `<setprop selector="#msg" prop="textContent" expr="'Hello'" />` — set property (use `expr` for JS, or `value` for literals).
  - `<setattr selector="#link" name="title" value="Info" />` — set attribute.
  - `<append target="#list"> <li>Row</li> </append>` — append generated children to an existing element.
  - `<class selector="#card" name="active" when="this.isActive" />` — toggle class based on expression.
  - `<style selector="#card" prop="background-color" value="red" />` — set inline style.
  - `<model selector="#name" path="name" />` — two-way input binding (`value` + `input` event).
- Visibility
  - `<toggle target="#panel" condition="isOpen" />` — show/hide (style.display).
  - `<show target="#a" when="x > 5" />` — sugar over TOGGLE.
- Reactive Bindings
  - `<bind selector="#cnt" prop="textContent" expr="String(state.items.length)" />` — binds DOM to an expression; updates on SET/PUSH/SPLICE.
  - Native component markup can also bind directly: `<p title="Count {count}">{label}: {count}</p>`.
- Lists (keyed)
  - `<keyedlist target="#ul" of="items" item="it" index="i" key="it.id"> <li>{it.name}</li> </keyedlist>` — component-scoped keyed list rendering with item/index interpolation and DOM node preservation for matching keys.
- Composition
  - Put one compiled custom element inside another as normal HTML. The compiler keeps custom-element children instead of treating them as unknown HTMS tags.
  - Use `<slot></slot>` and `<slot name="heading"></slot>` inside a component to accept default and named content from its parent.
  - SVG and MathML can sit directly in a component template, including interpolated attributes.
- Events
  - `<event target="#btn" type="click"> …child tags… </event>` — handler is composed of child tags (no action string required).
  - `<submit target="#form"> …child tags… </submit>` — form submit helper (prevents default). Use child tags to update state/DOM.
  - `<emit name="count-changed" detail="this.count" />` — dispatches a `CustomEvent` from the component so parents can react. Place it inside an `<event>`/`<submit>` handler. Defaults to `bubbles`/`composed` so the event crosses the shadow boundary; opt out with `bubbles="false"` / `composed="false"`, or set `cancelable="true"`.

## Component Demos

- `demos/hello-world-component.html` — minimal “hello” rendered via shadow DOM.
- `demos/event-toggle-component.html` — `<event>`, `<setattr>`, and `<toggle>` working together.
- `demos/bind-component.html` — `<bind>` hydrates text content without global state.
- `demos/counter-component.html` — `<var>`, `<set>`, and `<bind>` demonstrate reactive state and re-rendering.
- `demos/derived-component.html` — derived values update before template interpolation and bindings.
- `demos/emit-component.html` — `<emit>` dispatches a composed `CustomEvent` to the host so parents can listen.
- `demos/composition-component.html` — two compiled components composed with named and default slots.
- `demos/ssr-card-component.html` — typed props rendered on the server and updated through a client event.
- `demos/list-component.html` and `demos/todo-component.html` — repeat rendering, keyed updates, item events, and form state.
- `demos/effect-fetch-component.html`, `demos/effect-fetch-error-component.html`, and `demos/effect-fetch-auto-component.html` — request success, failure, cleanup, and automatic loading.

## Security boundary

HTMS rejects known executable sinks and unsafe template attributes, but source files are still application code. Do not compile untrusted markup and execute the result.
