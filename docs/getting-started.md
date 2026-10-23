# Getting started with HTMS

HTMS source looks like HTML because it is HTML. Normal elements describe the component's DOM. HTMS tags handle state and behaviour, then disappear when the file is compiled.

## Try an example in the browser

Run `npm ci` and `npm run demo:serve`, then open
`http://localhost:5173/demos/`. Choose an example, edit the source, and press
**Compile & preview** or Ctrl/⌘ + Enter. Compiler errors and hints appear
below the editor; click a source location to jump to it. **Reset example**
restores the original source. Edits survive example switches but not a reload.

The preview is sandboxed and blocks fetch and external resources. To run a
fetch example with network access, open its standalone
`/demos/<name>-component.preview.html` page. See the
[playground instructions](../README.md#component-demos) for limits and build details.

## Start a component

From this checkout, with Node 20.19 or newer:

```bash
npm ci
npm run build
npm run htms -- create click-counter
npm run htms -- dev click-counter.html
```

The last command starts the preview at `http://127.0.0.1:5173/`. Keep it running while you edit `click-counter.html`.

The generated file has three moving parts:

```html
<var name="count" value="0" mutable="true"></var>

<output>{count}</output>

<button type="button" on:click="count++">Make it count</button>
```

`<var>` creates component state. `{count}` prints its current value into normal markup. `on:click` runs a statement when the button is clicked; `count` refers to the component's field, so `count++` updates it and HTMS renders once.

Try changing `count++` to `count += 5`. Saving the file is enough.

When a handler grows, move it into a method or use the tag form:

```html
<function name="bump" params="amount">
  count += amount;
</function>

<button type="button" on:click="bump(5)">+5</button>

<!-- equivalent, written as tags -->
<event target="#reset" type="click">
  <set name="count" value="0"></set>
</event>
```

## Add an input

Components accept typed properties through the `props` attribute:

```html
<component name="welcome-card" props="name, visits:number">
  <p>Hello {name}. Visit number {visits}.</p>
</component>
```

Use it like any other custom element:

```html
<welcome-card name="Ada" visits="3"></welcome-card>
```

String props are the default. HTMS also understands `number`, `boolean` and `json`. Property and attribute changes are reactive.

## Add a list

`<repeat>` handles simple output. Use `<keyedlist>` when rows can move or keep their own DOM state.

```html
<component name="name-list">
  <var name="names" value='["Ada", "Lin", "Ida"]' mutable="true"></var>
  <var name="draft" value="''" mutable="true"></var>

  <form on:submit.prevent="names.push(draft); draft = ''">
    <input bind:value="draft" placeholder="Add a name">
  </form>

  <ul>
    <repeat variable="names" index="position">
      <li>{position + 1}: {item} <button on:click="names.splice(position, 1)">Remove</button></li>
    </repeat>
  </ul>
  <p if="names.length === 0">Nobody yet.</p>
</component>
```

`bind:value` keeps the input and `draft` in sync. Anything inside `{...}` is an expression, so `{position + 1}` and `{names.length}` work.

## Check before compiling

```bash
npm run htms -- validate click-counter.html
```

Validation uses the same parser, directive handlers and security checks as compilation. A typo such as `<repaet>` points back to its line and suggests `<repeat>`.

Compile when you want a bundle:

```bash
npm run htms -- compile click-counter.html
```

This writes `click-counter.js` and `click-counter.d.ts`. Load the JavaScript as a module, then place `<click-counter></click-counter>` anywhere on the page.

## Use an existing Vite app

With HTMS installed in your app, add its plugin to `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { htms } from 'htms/vite';

export default defineConfig({
  plugins: [htms()],
});
```

Import the component from your JavaScript or TypeScript entry:

```ts
import './click-counter.html?htms';
```

Then use `<click-counter></click-counter>` in your page. The `?htms` suffix
opts that file into compilation; your app's `index.html` and ordinary asset
imports are handled by Vite as usual. `.htm?htms` works too. No generated
JavaScript needs to be checked in or compiled by a separate watcher.

For TypeScript projects, add this to `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="htms/vite-client" />
```

The import declarations cover side-effect imports that register elements.
To get types for each component's props, methods and events, use the
`.d.ts` files emitted by `htms compile` and include them in your TypeScript
project.

The plugin accepts `strictMode`, `renderer` and `maxFileSize`:

```ts
htms({ strictMode: true, maxFileSize: 2 * 1024 * 1024 });
```

The default size limit is 1 MiB, measured in UTF-8 bytes. Compile errors
appear in Vite's overlay with their source location when available.
Generated JavaScript does not yet include source maps back to HTMS markup.
Asset URLs inside markup are preserved and resolve against the page. Use
URLs from Vite's public directory, or pass imported asset URLs through props.

Saving a component reloads the document. This resets component state because
the browser cannot redefine an already registered custom element class.
Other files keep Vite's usual hot-update behavior. Production builds retain
component registration even when you don't import the generated class.

## Where to go next

- [Component inputs, lifecycle and rendering](https://github.com/Vheissu/htms/blob/master/docs/web-components.md)
- [Working demo sources](https://github.com/Vheissu/htms/tree/master/demos)
- [Full tag glossary](https://github.com/Vheissu/htms#tag-glossary)

HTMS files are application code. The compiler blocks known dangerous sinks, but it should not be used to execute markup from strangers.
