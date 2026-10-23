import { expect, test } from '@playwright/test';
import { parseHTML } from '../../dist/parser';

interface MoveComponent extends HTMLElement {
  items: Array<{ id: number }>;
  updateComplete: Promise<void>;
}

for (const atomic of [true, false]) {
  for (const fragment of [false, true]) {
    test(`keyed ${fragment ? 'fragments' : 'elements'} move with ${atomic ? 'native moves' : 'insertBefore fallback'}`, async ({
      page,
    }) => {
      const result = parseHTML(
        `<component name="move-box">
          <var name="items" value='[{"id":1},{"id":2},{"id":3},{"id":4}]' mutable="true"></var>
          <div id="rows"><span>head</span>
            <repeat variable="items" item="row" index="i" key="row.id">
              <article data-id="{row.id}"><input value="draft"><b>{i}:{row.id}</b><move-probe></move-probe></article>
              ${fragment ? '<aside data-owner="{row.id}">{i}</aside>' : ''}
            </repeat>
            <span>tail</span>
          </div>
        </component>`,
        { mode: 'component' }
      );
      expect(result.success).toBe(true);
      await page.goto('about:blank');
      expect(
        await page.evaluate(
          () => typeof Reflect.get(Element.prototype, 'moveBefore')
        )
      ).toBe('function');
      if (!atomic) {
        await page.evaluate(() => {
          for (const prototype of [
            Element.prototype,
            DocumentFragment.prototype,
          ]) {
            Object.defineProperty(prototype, 'moveBefore', {
              configurable: true,
              value: undefined,
            });
          }
        });
      }
      await page.evaluate(() => {
        customElements.define(
          'move-probe',
          class extends HTMLElement {
            disconnectedCallback(): void {
              this.dataset.disconnects = String(
                Number(this.dataset.disconnects ?? 0) + 1
              );
            }
            connectedMoveCallback(): void {
              this.dataset.moves = String(Number(this.dataset.moves ?? 0) + 1);
            }
          }
        );
      });
      await page.addScriptTag({ content: result.code, type: 'module' });
      await page.setContent('<move-box></move-box>');
      const component = page.locator('move-box');
      const input = component.locator('article[data-id="1"] input');
      await input.fill('unfinished edit');
      await component.evaluate((node) => {
        for (const article of node.shadowRoot!.querySelectorAll('article')) {
          Reflect.set(article, 'originalNode', article.dataset.id);
        }
      });

      const orders = [
        [4, 2, 3, 1],
        [4, 3, 2, 1],
        [1, 4, 3, 2],
        [2, 3, 4, 1],
        [2, 5, 3, 4, 1],
        [5, 4, 1],
      ];
      for (const order of orders) {
        await component.evaluate(async (node: MoveComponent, ids) => {
          const previous = new Map(node.items.map((row) => [row.id, row]));
          node.items = ids.map((id) => previous.get(id) ?? { id });
          await node.updateComplete;
        }, order);
        await expect(component.locator('article b')).toHaveText(
          order.map((id, index) => `${index}:${id}`)
        );
        expect(
          await component
            .locator('article')
            .evaluateAll((articles) =>
              articles.map((article) => Reflect.get(article, 'originalNode'))
            )
        ).toEqual(order.map((id) => (id === 5 ? undefined : String(id))));
        if (fragment) {
          await expect(component.locator('aside')).toHaveText(
            order.map((_, index) => String(index))
          );
          expect(
            await component
              .locator('#rows')
              .evaluate((container) =>
                Array.from(container.children).map((child) =>
                  child.tagName === 'ARTICLE'
                    ? `row:${child.getAttribute('data-id')}`
                    : child.tagName === 'ASIDE'
                      ? `aside:${child.getAttribute('data-owner')}`
                      : child.textContent
                )
              )
          ).toEqual([
            'head',
            ...order.flatMap((id) => [`row:${id}`, `aside:${id}`]),
            'tail',
          ]);
        }
        await expect(input).toHaveValue('unfinished edit');
        if (atomic) {
          await expect(input).toBeFocused();
        }
      }
      const probe = component.locator('article[data-id="1"] move-probe');
      if (atomic) {
        await expect(probe).not.toHaveAttribute('data-disconnects');
        expect(Number(await probe.getAttribute('data-moves'))).toBeGreaterThan(
          0
        );
      } else {
        expect(
          Number(await probe.getAttribute('data-disconnects'))
        ).toBeGreaterThan(0);
      }
    });
  }
}
