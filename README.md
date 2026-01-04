# htms — Hyper Text Media Script

Write JavaScript with HTML tags. Yes, this is legal (and a little unhinged). No, you should not ship it to production without adult supervision.

## What is this?
HTMS turns HTML-ish markup into executable JavaScript. You compose control flow and DOM with tags like `<var>`, `<repeat>`, `<if>`, `<call>`, and plain-old `<div>`. A compiler converts that into JS with safety checks and lots of side‑eye.

## Quick Start
- Install deps: `npm ci`
- Build the TypeScript sources: `npm run build`
- Compile a component demo: `node dist/cli.js compile demos/hello-world-component.html --mode component --output demos/hello-world-component.js`
- Dev server (live reload): `node dist/cli.js dev demos/hello-world-component.html`
- Watch & recompile: `node dist/cli.js watch demos/hello-world-component.html`
- Optional: run browser smoke tests (Chromium required once via `npx playwright install chromium`): `npm run test:e2e`

## Dev Workflow
- `htms dev <component.html>` compiles, serves a generated preview page, and live-reloads on save.
- The dev server serves static files from the input file's directory. Open `http://localhost:5173/` for the auto preview or `http://localhost:5173/<your-page>.html` if you want a custom page.
- If your input has multiple components, use `--tag <name>` to pick which one gets mounted in the auto preview.
- `htms watch <component.html>` re-compiles to JS on every change without running a server.

## How It Works (roughly)
- Parses HTMS markup with JSDOM, converts nodes to directives via tag handlers, validates with Esprima, then emits JavaScript through Escodegen.
- A security pass rejects dangerous constructs (`eval`, inline handlers, raw `innerHTML`, path traversal, …).
- In component mode, standard elements become cached template fragments, while control/state tags compile into instructions that mutate the component instance and re-render the shadow DOM.

## Tag Glossary (HTML‑first)
- State & Arrays
  - `<var name="x" value="42" mutable="true" />` — declare `let x = 42` (accepts JSON).
  - `<set name="x" op="=|+=|-=|*=|/=|++|--" value="…" />` — mutate values; notifies bindings.
  - `<push array="state.list" expr="document.getElementById('txt').value" />` — push; notifies bindings.
  - `<splice array="state.list" index="0" delete="1" values='["New"]' />` — remove/insert; notifies bindings.
- Control Flow
  - `<repeat variable="items" index="i">…</repeat>` or `<repeat count="3">…</repeat>` — inside, use `{item}` in text nodes.
  - `<if condition="flag">…</if><else-if condition="other">…</else-if><else>…</else>` — nested tags allowed.
  - `<while condition="state.count < 3" max="1000">…</while>` — guarded loop; `max` prevents infinite loops.
  - `<switch variable="day">…</switch>` or `<switch expr="this.day">…</switch>` — nested tags allowed.
- DOM Updates
  - `<setprop selector="#msg" prop="textContent" expr="'Hello'" />` — set property (use `expr` for JS, or `value` for literals).
  - `<setattr selector="#link" name="title" value="'Info'" />` — set attribute.
  - `<append target="#list"> <li>Row</li> </append>` — append generated children to an existing element.
  - `<class selector="#card" name="active" when="this.isActive" />` — toggle class based on expression.
  - `<style selector="#card" prop="background-color" value="red" />` — set inline style.
  - `<model selector="#name" path="name" />` — two-way input binding (`value` + `input` event).
- Visibility
  - `<toggle target="#panel" condition="isOpen" />` — show/hide (style.display).
  - `<show target="#a" when="x > 5" />` — sugar over TOGGLE.
- Reactive Bindings
  - `<bind selector="#cnt" prop="textContent" expr="String(state.items.length)" />` — binds DOM to an expression; updates on SET/PUSH/SPLICE.
- Lists (keyed)
  - `<keyedlist target="#ul" of="state.items" item="it" index="i" key="it.id"> <li>{it.name}</li> </keyedlist>` — stable, keyed DOM updates.
- Events
  - `<event target="#btn" type="click"> …child tags… </event>` — handler is composed of child tags (no action string required).
  - `<submit target="#form"> …child tags… </submit>` — form submit helper (prevents default). Use child tags to update state/DOM.

## Component Demos
- `demos/hello-world-component.html` — minimal “hello” rendered via shadow DOM.
- `demos/event-toggle-component.html` — `<event>`, `<setattr>`, and `<toggle>` working together.
- `demos/bind-component.html` — `<bind>` hydrates text content without global state.
- `demos/counter-component.html` — `<var>`, `<set>`, and `<bind>` demonstrate reactive state and re-rendering.

## Disclaimers
- Do not paste untrusted content. The compiler tries to help, but it is not a firewall.
- This is a proof‑of‑concept with tests. If you build something real, we salute you (from a safe distance).
