# htms — Hyper Text Media Script

Write JavaScript with HTML tags. Yes, this is legal (and a little unhinged). No, you should not ship it to production without adult supervision.

## What is this?
HTMS turns HTML-ish markup into executable JavaScript. You compose control flow and DOM with tags like `<var>`, `<repeat>`, `<if>`, `<call>`, and plain-old `<div>`. A compiler converts that into JS with safety checks and lots of side‑eye.

## Quick Start
- Install deps: `npm ci`
- Build the compiler: `npm run build`
- Run all demos: `npm run demo:serve` (serves on http://localhost:5173 and builds everything under `demos/`).
- Or compile a single demo: `node dist/cli.js compile demos/todo-app.html -o demos/todo-app.js --format cjs`, then open `demos/todo-app.index.html`.

Alternative: `npx ts-node main.ts demos/mixed-tags.html` writes `demos/mixed-tags.js` next to the source.

## How It Works (roughly)
- Parses your tags with JSDOM, turns them into JS snippets via tag handlers, validates with Esprima, and emits code with Escodegen.
- A security layer blocks obviously cursed things (`eval`, inline event handlers, raw innerHTML assignments, etc.).
- Standard elements become `document.createElement(...)` calls; control tags become statements.

## Tags You Can Use
Quick reference — HTML-first building blocks:
- State: `<var name="x" value="42" mutable="true" />` (JSON allowed), `<set name="x" op="=|+=|-=|*=|/=|++|--" value="…" />`.
- Arrays: `<push array="state.todos" value="'Buy'" />`, `<splice array="state.todos" index="0" delete="1" values='["New"]' />`.
- Control Flow: `<repeat variable="items" index="i">…</repeat>` or `<repeat count="3">…</repeat>`; `<if>…</if><else>…</else>`; `<switch>…</switch>`.
- DOM: `<setprop selector="#msg" prop="textContent" value="'Hi'" />`, `<setattr selector="#a" name="title" value="'Info'" />`, `{item}` text interpolation inside loops.
- Visibility: `<toggle target="#panel" condition="isOpen" />`, `<show target="#a" when="x > 5" />`.
- Binding: `<bind selector="#cnt" prop="textContent" expr="String(state.items.length)" />` (updates when you use SET/PUSH/SPLICE).
- Lists: `<keyedlist target="#ul" of="state.items" item="it" index="i" key="it.id"> <li>{it.name}</li> </keyedlist>` (diffs by keys; reuses/moves nodes).
- Composition: `<append target="#container"> <div>…</div> </append>` appends generated children to an existing element.
- Events: `<event target="#btn" type="click"> …child tags… </event>`; or use `<submit target="#form"> …child tags… </submit>` (prevents default by default).

## Demo: Todo (because of course)
Source: `demos/todo-app.html` — compiles to `demos/todo-app.js`, then open `demos/todo-app.index.html`.
It renders an input, an “Add” button, a keyed list, and removal buttons — using PUSH, SPLICE, KEYEDLIST, EVENT, and SETPROP. All in tags.

## Disclaimers
- Do not paste untrusted content. The compiler tries to help, but it is not a firewall.
- This is a proof‑of‑concept with tests. If you build something real, we salute you (from a safe distance).
