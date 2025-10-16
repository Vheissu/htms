import { parseHTML } from '../../src/parser';

describe('Component compiler', () => {
  const compile = (markup: string): string => {
    const result = parseHTML(markup, { mode: 'component' });
    if (!result.success || !result.code) {
      throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
    }
    return result.code;
  };

  it('initialises state variables via __htmsInitState', () => {
    const code = compile(`
      <component name="state-box">
        <var name="count" value="0" mutable="true"></var>
        <bind selector="#out" prop="textContent" expr="String(this.count)"></bind>
        <div id="out"></div>
      </component>
    `);
    expect(code).toContain("this.__htmsInitState(['count'], () => 0);");
  });

  it('generates event handlers that re-render when state changes', () => {
    const code = compile(`
      <component name="event-box">
        <var name="count" value="0" mutable="true"></var>
        <button id="inc">Inc</button>
        <event target="#inc" type="click">
          <set name="count" op="++"></set>
        </event>
      </component>
    `);
    expect(code).toContain("this.__htmsSetState(['count'], '++'");
    expect(code).toContain('this.render();');
  });

  it('emits push and splice helpers', () => {
    const code = compile(`
      <component name="list-box">
        <var name="items" value="[]" mutable="true"></var>
        <button id="add">Add</button>
        <event target="#add" type="click">
          <push array="items" value="next"></push>
          <splice array="items" index="0" delete="1" values='["first"]'></splice>
        </event>
      </component>
    `);
    expect(code).toContain("this.__htmsPushState(['items']");
    expect(code).toContain("this.__htmsSpliceState(['items']");
  });

  it('renders repeat loops inside render()', () => {
    const code = compile(`
      <component name="loop-box">
        <repeat variable="items" index="i">
          <div class="item">{item}</div>
        </repeat>
      </component>
    `);
    expect(code).toContain('for (let i = 0; i < items.length');
    expect(code).toContain('const _frag');
  });

  it('handles switch/case branches', () => {
    const code = compile(`
      <component name="switch-box">
        <switch variable="mode">
          <case value="on"><div class="on"></div></case>
          <default><div class="off"></div></default>
        </switch>
      </component>
    `);
    expect(code).toContain('const _switch');
    expect(code).toContain('if (_switch');
    expect(code).toContain('else {');
  });

  it('creates visibility directives for toggle', () => {
    const code = compile(`
      <component name="toggle-box">
        <toggle target="#panel" condition="flag"></toggle>
        <div id="panel"></div>
      </component>
    `);
    expect(code).toContain("componentRoot.querySelectorAll('#panel')");
    expect(code).toMatch(/node\.style\.display = .*flag.*\? '' : 'none';/);
  });

  it('appends children to existing nodes', () => {
    const code = compile(`
      <component name="append-box">
        <div id="target"></div>
        <append target="#target">
          <span class="child">Hi</span>
        </append>
      </component>
    `);
    expect(code).toContain("componentRoot.querySelectorAll('#target')");
    expect(code).toContain('node.appendChild(_frag');
  });

  it('emits effect runtime registration with component ownership', () => {
    const code = compile(`
      <component name="effect-box">
        <effect deps="this.count">
          console.log(this.count);
        </effect>
      </component>
    `);
    expect(code).toContain('registerEffect({');
    expect(code).toContain('owner: owner');
    expect(code).toContain('console.log(this.count)');
  });

  it('wires fetch directives into render pipeline', () => {
    const code = compile(`
      <component name="fetch-box">
        <var name="state" value="{}" mutable="true"></var>
        <fetch url="this.getUrl()" into="state.data" error="state.error" loading="state.loading" when="this.shouldFetch"></fetch>
      </component>
    `);
    expect(code).toContain('fetch(');
    expect(code).toContain('}(this));');
    expect(code).toContain("target['state']");
    expect(code).toContain('this.render();');
  });

  it('rejects documents without a component root', () => {
    const result = parseHTML('<div>oops</div>', { mode: 'component' });
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Wrap markup in a <component>');
  });
});
