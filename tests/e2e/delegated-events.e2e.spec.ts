import { expect, test } from '@playwright/test';
import { parseHTML } from '../../dist/parser';

interface EventComponent extends HTMLElement {
  items: Array<{ id: number; label: string }>;
  updateComplete: Promise<void>;
}

test('delegated row events retain their context after garbage collection', async ({
  page,
}) => {
  const result = parseHTML(
    `<component name="event-context-box">
      <var name="items" value="[]" mutable="true"></var>
      <var name="seen" value="''" mutable="true"></var>
      <div><repeat variable="items" item="row" index="i" key="row.id">
        <button data-id="{row.id}" on:click="seen = row.label + ':' + i" on:keydown="seen = event.key + ':' + row.label">{row.label}</button>
      </repeat></div>
      <p>{seen}</p>
    </component>`,
    { mode: 'component' }
  );
  expect(result.success).toBe(true);
  await page.goto('about:blank');
  await page.addScriptTag({ content: result.code, type: 'module' });
  await page.setContent('<event-context-box></event-context-box>');
  const component = page.locator('event-context-box');
  for (const items of [
    [
      { id: 1, label: 'old' },
      { id: 2, label: 'other' },
    ],
    [
      { id: 2, label: 'other' },
      { id: 1, label: 'new' },
    ],
  ]) {
    await component.evaluate(async (node: EventComponent, items) => {
      node.items = items;
      await node.updateComplete;
    }, items);
    const session = await page.context().newCDPSession(page);
    await session.send('HeapProfiler.collectGarbage');
    await session.detach();
  }
  const button = component.locator('button[data-id="1"]');
  await button.click();
  await expect(component.locator('p')).toHaveText('new:1');
  await button.press('ArrowDown');
  await expect(component.locator('p')).toHaveText('ArrowDown:new');
  await button.evaluate((node) => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'X' }));
  });
  await expect(component.locator('p')).toHaveText('X:new');
});
