import path from 'path';
import { TransformStream } from 'stream/web';
import { test, expect } from '@playwright/test';

if (typeof (globalThis as any).TransformStream === 'undefined') {
  (globalThis as any).TransformStream = TransformStream;
}

const HELLO_JS = path.resolve(__dirname, '../../demos/hello-world-component.js');
const FLASH_JS = path.resolve(__dirname, '../../demos/event-toggle-component.js');
const BIND_JS = path.resolve(__dirname, '../../demos/bind-component.js');
const COUNTER_JS = path.resolve(__dirname, '../../demos/counter-component.js');

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

    const getCount = () =>
      page.locator('counter-box').evaluate((el) => {
        const shadow = el.shadowRoot;
        const valueEl = shadow?.querySelector('#count');
        return valueEl?.textContent?.trim();
      });

    expect(await getCount()).toBe('0');

    await page.locator('counter-box').locator('button#increment').click();
    expect(await getCount()).toBe('1');
  });
});
