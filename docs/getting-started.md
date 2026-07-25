# Getting started with HTMS

HTMS source looks like HTML because it is HTML. Normal elements describe the component's DOM. HTMS tags handle state and behaviour, then disappear when the file is compiled.

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

<event target="#increment" type="click">
  <set name="count" op="++"></set>
</event>
```

`<var>` creates component state. `{count}` prints its current value into normal markup. The event finds `#increment` inside the component and increments the same field. HTMS batches the update and renders once.

Try changing `<set name="count" op="++">` to `op="+=" value="5"`. Saving the file is enough.

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

  <ul>
    <repeat variable="names" index="position">
      <li>{position}: {item}</li>
    </repeat>
  </ul>
</component>
```

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

## Where to go next

- [Component inputs, lifecycle and rendering](https://github.com/Vheissu/htms/blob/master/docs/web-components.md)
- [Working demo sources](https://github.com/Vheissu/htms/tree/master/demos)
- [Full tag glossary](https://github.com/Vheissu/htms#tag-glossary)

HTMS files are application code. The compiler blocks known dangerous sinks, but it should not be used to execute markup from strangers.
