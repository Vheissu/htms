import { expect, test } from '@playwright/test';
import { parseHTML } from '../../dist/parser';

interface ReconcilerComponent extends HTMLElement {
  items: Array<{ id: number }>;
  tick: number;
  updateComplete: Promise<void>;
}

test('reconciliation retains focused edits and keyed rows while clearing other content', async ({
  page,
}) => {
  const result = parseHTML(
    `<component name="reconciler-box">
      <var name="items" value='[{"id":1},{"id":2},{"id":3}]' mutable="true"></var>
      <var name="tick" value="0" mutable="true"></var>
      <input id="draft" value="initial">
      <details><summary>More</summary><p>{tick}</p></details>
      <div id="rows"><repeat variable="items" item="row" key="row.id">
        <span data-id="{row.id}">{row.id}</span>
      </repeat></div>
    </component>`,
    { mode: 'component', renderer: 'legacy' }
  );
  expect(result.success).toBe(true);
  await page.goto('about:blank');
  await page.addScriptTag({ content: result.code, type: 'module' });
  await page.setContent('<reconciler-box></reconciler-box>');
  const component = page.locator('reconciler-box');
  const input = component.locator('#draft');
  await input.fill('unfinished edit');
  await input.evaluate((node: HTMLInputElement) =>
    node.setSelectionRange(2, 7)
  );
  await component.evaluate((node) => {
    const details = node.shadowRoot!.querySelector('details')!;
    details.open = true;
    details.classList.add('external');
    for (const row of node.shadowRoot!.querySelectorAll('#rows span')) {
      Reflect.set(row, 'originalId', row.getAttribute('data-id'));
    }
  });

  for (const ids of [[3, 1, 2], [], [4, 5]]) {
    await component.evaluate(async (node: ReconcilerComponent, ids) => {
      node.items = ids.map((id) => ({ id }));
      node.tick += 1;
      await node.updateComplete;
    }, ids);
    await expect(component.locator('#rows span')).toHaveText(ids.map(String));
    if (ids[0] === 3) {
      expect(
        await component
          .locator('#rows span')
          .evaluateAll((rows) =>
            rows.map((row) => Reflect.get(row, 'originalId'))
          )
      ).toEqual(['3', '1', '2']);
    }
    await expect(input).toHaveValue('unfinished edit');
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((node: HTMLInputElement) => [
        node.selectionStart,
        node.selectionEnd,
      ])
    ).toEqual([2, 7]);
    await expect(component.locator('details')).toHaveAttribute('open');
    await expect(component.locator('details')).toHaveClass('external');
  }
});
