import { renderToString, ServerRenderError } from '../src/server-renderer';

describe('Server renderer', () => {
  it('renders component state and props into declarative shadow DOM', () => {
    const result = renderToString(
      `
        <component name="server-card" props="label:string, count:number">
          <var name="suffix" value="'items'" mutable="true"></var>
          <article id="content">{label}: {count} {suffix}</article>
        </component>
      `,
      {
        props: { label: 'Saved', count: 3 },
        attributes: { class: 'featured' },
      }
    );

    expect(result.componentHtml).toContain(
      '<server-card class="featured" data-htms-id="0" data-htms-ssr="">'
    );
    expect(result.componentHtml).toContain(
      '<template shadowrootmode="open" data-htms-shadow>'
    );
    expect(result.componentHtml).toContain('Saved: 3 items');
    expect(result.manifest).toEqual({
      version: 1,
      components: [
        {
          id: '0',
          tagName: 'server-card',
          shadowMode: 'open',
          props: { label: 'Saved', count: 3 },
        },
      ],
    });
    expect(result.html).toContain('data-htms-hydration');
  });

  it('renders light DOM components without a shadow template', () => {
    const result = renderToString(
      `
        <component name="light-card" shadow="none" props="label">
          <p>{label}</p>
        </component>
      `,
      { props: { label: 'Visible' }, includeManifestScript: false }
    );

    expect(result.html).toContain('<light-card');
    expect(result.html).toContain('<p>Visible</p>');
    expect(result.html).not.toContain('shadowrootmode');
    expect(result.html).not.toContain('data-htms-hydration');
  });

  it('serializes declarative shadow roots for nested components', () => {
    const result = renderToString(
      `
        <component name="server-shell">
          <nested-card label="Nested"></nested-card>
        </component>
        <component name="nested-card" props="label">
          <strong>{label}</strong>
        </component>
      `,
      { tagName: 'server-shell', hydrationId: 'shell-1' }
    );

    expect(result.componentHtml).toContain('data-htms-id="shell-1"');
    expect(result.componentHtml).toContain(
      '<nested-card label="Nested"><template shadowrootmode="open" data-htms-shadow><strong>Nested</strong></template></nested-card>'
    );
    expect(result.manifest.components[0].id).toBe('shell-1');
  });

  it('keeps effect and fetch registration dormant during SSR', () => {
    const result = renderToString(`
      <component name="server-effect">
        <p>Ready</p>
        <effect run="globalThis.__effectRan = true"></effect>
        <fetch url="'/api/items'" into="items" immediate="true"></fetch>
      </component>
    `);

    expect(result.componentHtml).toContain('<p>Ready</p>');
    expect(result.code).toContain('window.__HTMS_SSR__');
  });

  it('escapes closing markup in hydration data', () => {
    const result = renderToString(
      `
        <component name="safe-manifest" props="label">
          <p>{label}</p>
        </component>
      `,
      { props: { label: '</script><script>alert(1)</script>' } }
    );

    const manifestMarkup = result.html.slice(
      result.html.indexOf('<script type="application/json"')
    );
    expect(manifestMarkup).toContain('\\u003c/script>');
    expect(manifestMarkup).not.toContain('</script><script>');
  });

  it('reports unknown server properties', () => {
    expect(() =>
      renderToString(
        '<component name="strict-card" props="label"></component>',
        { props: { missing: true } }
      )
    ).toThrow(ServerRenderError);
  });
});
