import path from 'path';
import { TransformStream } from 'stream/web';
import { test, expect } from '@playwright/test';
import { renderToString } from '../../src/server-renderer';

interface TransformStreamGlobal {
  TransformStream?: typeof TransformStream;
}

const transformStreamGlobal = globalThis as unknown as TransformStreamGlobal;
if (typeof transformStreamGlobal.TransformStream === 'undefined') {
  transformStreamGlobal.TransformStream = TransformStream;
}

const HELLO_JS = path.resolve(
  __dirname,
  '../../demos/hello-world-component.js'
);
const FLASH_JS = path.resolve(
  __dirname,
  '../../demos/event-toggle-component.js'
);
const BIND_JS = path.resolve(__dirname, '../../demos/bind-component.js');
const COUNTER_JS = path.resolve(__dirname, '../../demos/counter-component.js');
const DERIVED_JS = path.resolve(__dirname, '../../demos/derived-component.js');
const LIST_JS = path.resolve(__dirname, '../../demos/list-component.js');
const EFFECT_FETCH_JS = path.resolve(
  __dirname,
  '../../demos/effect-fetch-component.js'
);
const EFFECT_FETCH_ERROR_JS = path.resolve(
  __dirname,
  '../../demos/effect-fetch-error-component.js'
);
const EFFECT_FETCH_AUTO_JS = path.resolve(
  __dirname,
  '../../demos/effect-fetch-auto-component.js'
);
const EMIT_JS = path.resolve(__dirname, '../../demos/emit-component.js');
const COMPOSITION_JS = path.resolve(
  __dirname,
  '../../demos/composition-component.js'
);

test.describe('hello-world component', () => {
  test('renders shadow DOM content', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: HELLO_JS, type: 'module' });

    await page.setContent('<hello-world></hello-world>');

    const shadowText = await page.locator('hello-world').evaluate((el) => {
      const shadow = el.shadowRoot;
      if (!shadow) {
        throw new Error('shadow root missing');
      }
      return shadow.textContent?.trim();
    });

    expect(shadowText).toContain('Hello from HTMS components!');
  });

  test('handles event-driven attribute update', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: FLASH_JS, type: 'module' });

    await page.setContent('<flash-box></flash-box>');

    const panelAttrBefore = await page.locator('flash-box').evaluate((el) => {
      const shadow = el.shadowRoot;
      const panel = shadow?.querySelector('#panel');
      return panel?.getAttribute('data-state');
    });

    expect(panelAttrBefore).toBeNull();

    await page.locator('flash-box').locator('button#activate').click();

    const panelAttrAfter = await page.locator('flash-box').evaluate((el) => {
      const shadow = el.shadowRoot;
      const panel = shadow?.querySelector('#panel');
      return panel?.getAttribute('data-state');
    });

    expect(panelAttrAfter).toBe('active');
  });

  test('bind applies expression result', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: BIND_JS, type: 'module' });

    await page.setContent('<bind-box></bind-box>');

    const boundText = await page.locator('bind-box').evaluate((el) => {
      const shadow = el.shadowRoot;
      const valueEl = shadow?.querySelector('#value');
      return valueEl?.textContent?.trim();
    });

    expect(boundText).toBe('Initial value');
  });

  test('set/push directives update component state', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: COUNTER_JS, type: 'module' });

    await page.setContent('<counter-box></counter-box>');

    const getCount = (): Promise<string | undefined> =>
      page.locator('counter-box').evaluate((el) => {
        const shadow = el.shadowRoot;
        const valueEl = shadow?.querySelector('#count');
        return valueEl?.textContent?.trim();
      });

    expect(await getCount()).toBe('0');

    await page.locator('counter-box').locator('button#increment').click();
    expect(await getCount()).toBe('1');
  });

  test('derived state recomputes through the browser demo', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: DERIVED_JS, type: 'module' });

    await page.setContent('<derived-box label-text="Items"></derived-box>');

    const component = page.locator('derived-box');
    const readState = (): Promise<{
      status: string | undefined;
      summary: string | undefined;
      title: string | null | undefined;
    }> =>
      component.evaluate((el) => {
        const shadow = el.shadowRoot;
        const status = shadow?.querySelector('#status');
        const summary = shadow?.querySelector('#summary');
        return {
          status: status?.textContent?.trim(),
          summary: summary?.textContent?.trim(),
          title: summary?.getAttribute('title'),
        };
      });

    await expect.poll(readState).toEqual({
      status: 'Items: 1',
      summary: 'Total items: 1',
      title: 'Count 1',
    });

    await component.locator('button#add').click();

    await expect.poll(readState).toEqual({
      status: 'Items: 2',
      summary: 'Total items: 2',
      title: 'Count 2',
    });
  });

  test('component keyed lists render and handle item events', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: LIST_JS, type: 'module' });

    await page.setContent('<list-box></list-box>');

    const component = page.locator('list-box');
    const readRows = (): Promise<
      Array<{ text: string | undefined; key: string | null }>
    > =>
      component.evaluate((el) => {
        const shadow = el.shadowRoot;
        return Array.from(shadow?.querySelectorAll('li.person') ?? []).map(
          (row) => ({
            text: row.textContent?.replace('Remove', '').trim(),
            key: row.getAttribute('data-key'),
          })
        );
      });

    await expect.poll(readRows).toEqual([
      { text: 'Ada', key: 'Ada' },
      { text: 'Lin', key: 'Lin' },
      { text: 'Ida', key: 'Ida' },
    ]);

    await component.evaluate((el) => {
      const row = el.shadowRoot?.querySelector('li.person[data-key="Lin"]');
      if (row) {
        (row as HTMLElement & { __htmsMarker?: string }).__htmsMarker =
          'preserved';
      }
    });

    await component.locator('button.promote').first().click();

    await expect.poll(readRows).toEqual([
      { text: 'Lin', key: 'Lin' },
      { text: 'Ida', key: 'Ida' },
    ]);

    await expect
      .poll(() =>
        component.evaluate((el) => {
          const row = el.shadowRoot?.querySelector(
            'li.person[data-key="Lin"]'
          ) as (HTMLElement & { __htmsMarker?: string }) | null;
          return row?.__htmsMarker;
        })
      )
      .toBe('preserved');
  });
});

test.describe('server rendering and hydration', () => {
  test('adopts server markup and preserves DOM identity on client updates', async ({
    page,
  }) => {
    const rendered = renderToString(
      `
        <component name="browser-hydration" props="label">
          <var name="count" value="0" mutable="true"></var>
          <p id="content">{label}: {count}</p>
          <button id="increment">Increment</button>
          <event target="#increment" type="click">
            <set name="count" op="++"></set>
          </event>
        </component>
      `,
      { props: { label: 'From server' } }
    );

    await page.setContent(rendered.html);
    await page.locator('browser-hydration').evaluate((element) => {
      const content = element.shadowRoot?.querySelector('#content') as
        | (HTMLElement & { __serverMarker?: string })
        | null;
      if (!content) {
        throw new Error('Declarative shadow content missing');
      }
      content.__serverMarker = 'preserved';
    });

    await page.addScriptTag({ content: rendered.code });
    await page.locator('browser-hydration').evaluate(async (element) => {
      const component = element as HTMLElement & {
        label: string;
        updateComplete: Promise<void>;
      };
      component.label = 'From client';
      await component.updateComplete;
    });
    await page.locator('browser-hydration').locator('button#increment').click();

    const clientState = await page
      .locator('browser-hydration')
      .evaluate((element) => {
        const content = element.shadowRoot?.querySelector('#content') as
          | (HTMLElement & { __serverMarker?: string })
          | null;
        return {
          marker: content?.__serverMarker,
          text: content?.textContent,
        };
      });

    expect(clientState).toEqual({
      marker: 'preserved',
      text: 'From client: 1',
    });
  });
});

test.describe('emit component', () => {
  test('dispatches a composed custom event that crosses the shadow boundary', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: EMIT_JS, type: 'module' });

    await page.setContent('<emit-counter></emit-counter>');

    await page.evaluate(() => {
      (window as unknown as { __emitted: number[] }).__emitted = [];
      document
        .querySelector('emit-counter')
        ?.addEventListener('count-changed', (event) => {
          (window as unknown as { __emitted: number[] }).__emitted.push(
            (event as CustomEvent<number>).detail
          );
        });
    });

    await page.locator('emit-counter').locator('button#inc').click();
    await page.locator('emit-counter').locator('button#inc').click();

    const emitted = await page.evaluate(
      () => (window as unknown as { __emitted: number[] }).__emitted
    );

    expect(emitted).toEqual([1, 2]);
  });
});

test.describe('component composition', () => {
  test('projects named and default content through nested components', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: COMPOSITION_JS, type: 'module' });
    await page.setContent('<composition-demo></composition-demo>');

    const result = await page.locator('composition-demo').evaluate((demo) => {
      const card = demo.shadowRoot?.querySelector('profile-card');
      const headingSlot = card?.shadowRoot?.querySelector(
        'slot[name="heading"]'
      ) as HTMLSlotElement | null;
      const bodySlot = card?.shadowRoot?.querySelector(
        'slot:not([name])'
      ) as HTMLSlotElement | null;
      const icon = card?.shadowRoot?.querySelector('svg');

      return {
        heading: headingSlot?.assignedElements()[0]?.textContent?.trim(),
        body: bodySlot?.assignedElements()[0]?.textContent?.trim(),
        iconNamespace: icon?.namespaceURI,
      };
    });

    expect(result).toEqual({
      heading: 'Ada Lovelace',
      body: 'Wrote the first published algorithm intended for a machine.',
      iconNamespace: 'http://www.w3.org/2000/svg',
    });
  });
});

test.describe('effect + fetch demo', () => {
  test('loads remote data via FETCH tag and updates view through EFFECT', async ({
    page,
  }) => {
    await page.route('**/demo-quote.json', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'Integration works!' }),
      });
    });

    await page.goto('about:blank');
    await page.addScriptTag({ path: EFFECT_FETCH_JS, type: 'module' });
    await page.setContent('<effect-fetch-demo></effect-fetch-demo>');

    const component = page.locator('effect-fetch-demo');
    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-demo');
      return !!el?.shadowRoot?.querySelector('#status');
    });
    const initialStatus = await component.evaluate((el) => {
      const shadow = el.shadowRoot;
      return shadow?.querySelector('#status')?.textContent?.trim();
    });
    expect(initialStatus).toBe('Status: Idle');

    await component.locator('button#load').click();

    const effectIds = await page.evaluate(() => {
      return Array.isArray(window.__htms?.effects)
        ? window.__htms.effects.map((effect) => effect.id)
        : [];
    });
    expect(effectIds.some((id) => id.startsWith('__fetch_'))).toBe(true);

    const fetchEffectState = await page.evaluate(() => {
      if (!Array.isArray(window.__htms?.effects)) {
        return null;
      }
      const record = window.__htms.effects.find(
        (effect) =>
          typeof effect.id === 'string' && effect.id.startsWith('__fetch_')
      );
      if (!record) {
        return null;
      }
      return {
        dirty: record.dirty,
        initialized: record.initialized,
        skipInitial: record.skipInitial,
        lastValues: record.lastValues,
      };
    });
    expect(fetchEffectState).not.toBeNull();
    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-demo');
      return !!el?.state?.quote;
    });

    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-demo');
      const shadow = el?.shadowRoot;
      const status = shadow?.querySelector('#status')?.textContent?.trim();
      return status === 'Status: Loaded';
    });
    const quoteText = await component.evaluate((el) => {
      const shadow = el.shadowRoot;
      return shadow?.querySelector('#quote')?.textContent?.trim();
    });
    const errorText = await component.evaluate((el) => {
      const shadow = el.shadowRoot;
      return shadow?.querySelector('#error')?.textContent?.trim();
    });

    expect(quoteText).toBe('Integration works!');
    expect(errorText).toBe('');
  });
});

test.describe('effect + fetch (error) demo', () => {
  test('surfaces errors from failing fetches', async ({ page }) => {
    await page.route('**/demo-error.json', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Server exploded' }),
      });
    });

    await page.goto('about:blank');
    await page.addScriptTag({ path: EFFECT_FETCH_ERROR_JS, type: 'module' });
    await page.setContent(
      '<effect-fetch-error-demo></effect-fetch-error-demo>'
    );

    const component = page.locator('effect-fetch-error-demo');
    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-error-demo');
      return !!el?.shadowRoot?.querySelector('#status');
    });

    await component.locator('button#load').click();

    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-error-demo');
      const shadow = el?.shadowRoot;
      const status = shadow?.querySelector('#status')?.textContent?.trim();
      return status === 'Status: Error';
    });

    const errorText = await component.evaluate((el) => {
      const shadow = el.shadowRoot;
      return shadow?.querySelector('#error')?.textContent?.trim();
    });

    expect(errorText).toContain('Request failed with status 500');
  });
});

test.describe('effect + fetch (auto) demo', () => {
  test('prefetches on mount and refreshes on demand', async ({ page }) => {
    let callCount = 0;
    await page.route('**/demo-quote.json', (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: `Quote ${callCount}` }),
      });
    });

    await page.goto('about:blank');
    await page.addScriptTag({ path: EFFECT_FETCH_AUTO_JS, type: 'module' });
    await page.setContent('<effect-fetch-auto-demo></effect-fetch-auto-demo>');

    const component = page.locator('effect-fetch-auto-demo');
    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-auto-demo');
      const shadow = el?.shadowRoot;
      return shadow?.querySelector('#quote')?.textContent?.trim() === 'Quote 1';
    });

    await component.locator('button#refresh').click();

    await page.waitForFunction(() => {
      const el = document.querySelector('effect-fetch-auto-demo');
      const shadow = el?.shadowRoot;
      return shadow?.querySelector('#quote')?.textContent?.trim() === 'Quote 2';
    });

    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
