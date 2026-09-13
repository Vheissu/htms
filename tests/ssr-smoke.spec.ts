import { renderToString } from '../src/server-renderer';

describe('SSR smoke', () => {
  it('renders nested directives server-side', () => {
    const result = renderToString(`
<component name="ssr-nested">
  <var name="count" value="2" mutable="true"></var>
  <div class="wrap">
    <button id="inc">+</button>
    <event target="#inc" type="click"><set name="count" op="++"></set></event>
    <if condition="this.count > 0"><p>clicked {count}</p></if>
  </div>
</component>`);
    expect(result.componentHtml).toContain('clicked 2');
    expect(result.componentHtml).not.toContain('<event');
  });
});
