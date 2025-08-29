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
- `<var name="x" value="42" mutable="true" />` → declares `let x = 42` (omit `mutable` for `const`). Accepts JSON arrays/objects.
- `<set name="state.count" op="+=" value="1" />` → safe assignments (also `=, -=, *=, /=, ++, --`).
- `<repeat variable="items">…</repeat>` or `<repeat count="3">…</repeat>`; inside loops you may interpolate `{item}` in text nodes.
- `<if condition="count > 0">…</if><else>…</else>` → nested tags allowed in both branches.
- `<call function="console.log" args="'Hello', name" />` → whitelisted/validated args.
- `<event target="#btn" type="click" action="doThing()" />` → adds a listener (action must be a function call string).

## Demo: Todo (because of course)
Source: `demos/todo-app.html` — compiles to `demos/todo-app.js`, then open `demos/todo-app.index.html`.
It renders an input, an “Add” button, a list, and wires events to push new todos. All written in tags. Because we could.

## Disclaimers
- Do not paste untrusted content. The compiler tries to help, but it is not a firewall.
- This is a proof‑of‑concept with tests. If you build something real, we salute you (from a safe distance).
