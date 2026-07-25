import { hydrate, HydrationManifest } from '../src/hydration';
import { renderToString } from '../src/server-renderer';

describe('Hydration', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('adopts declarative shadow markup and preserves server DOM identity', async () => {
    const serverResult = renderToString(
      `
        <component name="hydrated-card" props="label:string">
          <article id="content">{label}</article>
        </component>
      `,
      { props: { label: 'Server label' } }
    );

    document.body.innerHTML = serverResult.html;
    const host = document.querySelector('hydrated-card');
    const template = host?.querySelector<HTMLTemplateElement>(
      'template[data-htms-shadow]'
    );
    const serverNode = template?.content.querySelector('#content');
    expect(serverNode).not.toBeNull();

    new Function(serverResult.code)();

    const manifest: HydrationManifest = {
      ...serverResult.manifest,
      components: serverResult.manifest.components.map((component) => ({
        ...component,
        props: { label: 'Client label' },
      })),
    };
    const hydration = await hydrate(document, manifest);
    const upgraded = document.querySelector('hydrated-card') as HTMLElement & {
      shadowRoot: ShadowRoot;
    };
    const hydratedNode = upgraded.shadowRoot.querySelector('#content');

    expect(hydration.errors).toEqual([]);
    expect(hydration.hydrated).toEqual([upgraded]);
    expect(hydratedNode).toBe(serverNode);
    expect(hydratedNode?.textContent).toBe('Client label');
    expect(upgraded.hasAttribute('data-htms-ssr')).toBe(false);
    expect(upgraded.querySelector('template[data-htms-shadow]')).toBeNull();
  });

  it('reads an embedded manifest when none is passed', async () => {
    const serverResult = renderToString(
      `
        <component name="manifest-card" shadow="none" props="label">
          <span>{label}</span>
        </component>
      `,
      { props: { label: 'Ready' } }
    );
    document.body.innerHTML = serverResult.html;
    new Function(serverResult.code)();

    const result = await hydrate(document);

    expect(result.errors).toEqual([]);
    expect(result.hydrated).toHaveLength(1);
    expect(result.hydrated[0].textContent).toBe('Ready');
  });

  it('reports missing hydration targets without aborting', async () => {
    const result = await hydrate(document, {
      version: 1,
      components: [
        {
          id: 'missing',
          tagName: 'missing-card',
          shadowMode: 'open',
          props: {},
        },
      ],
    });

    expect(result.hydrated).toEqual([]);
    expect(result.errors).toEqual([
      'Hydration target missing-card[data-htms-id="missing"] was not found',
    ]);
  });

  it('combines embedded manifests for several server-rendered roots', async () => {
    const first = renderToString(
      '<component name="first-root" shadow="none"><p>First</p></component>',
      { hydrationId: 'first' }
    );
    const second = renderToString(
      '<component name="second-root" shadow="none"><p>Second</p></component>',
      { hydrationId: 'second' }
    );
    document.body.innerHTML = `${first.html}${second.html}`;
    new Function(first.code)();
    new Function(second.code)();

    const result = await hydrate(document);

    expect(result.errors).toEqual([]);
    expect(result.hydrated.map((element) => element.localName)).toEqual([
      'first-root',
      'second-root',
    ]);
  });

  it('rejects unsafe property names in untrusted manifests', async () => {
    const manifest = JSON.parse(`{
      "version": 1,
      "components": [{
        "id": "unsafe",
        "tagName": "unsafe-card",
        "shadowMode": "open",
        "props": { "__proto__": { "polluted": true } }
      }]
    }`) as HydrationManifest;

    await expect(hydrate(document, manifest)).rejects.toThrow(
      'Unsafe property "__proto__"'
    );
  });

  it('reports a target whose component bundle was not loaded', async () => {
    document.body.innerHTML =
      '<unregistered-card data-htms-id="unregistered" data-htms-ssr></unregistered-card>';

    const result = await hydrate(document, {
      version: 1,
      components: [
        {
          id: 'unregistered',
          tagName: 'unregistered-card',
          shadowMode: 'open',
          props: {},
        },
      ],
    });

    expect(result.hydrated).toEqual([]);
    expect(result.errors[0]).toContain('has not been upgraded');
  });
});
