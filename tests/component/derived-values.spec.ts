import { click, mountComponent, query } from './test-utils';

describe('derived value invalidation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('keeps projections on unrelated updates and refreshes dependent chains', async () => {
    const element = await mountComponent(`
      <var name="items" value='[{"price":2},{"price":3}]' mutable="true"></var>
      <var name="label" value="'Ready'" mutable="true"></var>
      <derive name="prices" expr="items.map(item => item.price)"></derive>
      <derive name="total" expr="prices.reduce((sum, price) => sum + price, 0)"></derive>
      <p id="total">{total}</p><p id="label">{label}</p>
      <button on:click="items[0].price++">Change price</button>
    `);
    const original = element.prices;
    expect(query(element, '#total').textContent).toBe('5');

    element.label = 'Updated';
    await element.updateComplete;
    expect(element.prices).toBe(original);
    expect(query(element, '#label').textContent).toBe('Updated');

    await click(element, 'button');
    expect(element.prices).not.toBe(original);
    expect(query(element, '#total').textContent).toBe('6');

    element.items = [{ price: 10 }];
    await element.updateComplete;
    expect(query(element, '#total').textContent).toBe('10');

    (element.items as Array<{ price: number }>)[0].price = 12;
    await element.requestUpdate();
    expect(query(element, '#total').textContent).toBe('12');
  });

  it('reruns referenced callbacks whose side effects cannot be proven absent', async () => {
    const element = await mountComponent(`
      <var name="items" value="[1,2]" mutable="true"></var>
      <var name="callback" value="null" mutable="true"></var>
      <var name="label" value="'Ready'" mutable="true"></var>
      <derive name="mapped" expr="callback ? items.map(callback) : []"></derive>
      <p>{mapped.join(',')} {label}</p>
    `);
    const callback = jest.fn((item: number) => item * 2);
    element.callback = callback;
    await element.updateComplete;
    expect(callback).toHaveBeenCalledTimes(2);

    element.label = 'Changed';
    await element.updateComplete;
    expect(callback).toHaveBeenCalledTimes(4);
    expect(query(element, 'p').textContent).toBe('2,4 Changed');
  });

  it('runs volatile derives on direct renders and reconnection', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(100);
    const element = await mountComponent(`
      <derive name="timestamp" expr="Date.now()"></derive>
      <p>{timestamp}</p>
    `);
    expect(element.timestamp).toBe(100);
    now.mockReturnValue(200);
    (element as unknown as { render(): void }).render();
    expect(element.timestamp).toBe(200);

    element.remove();
    now.mockReturnValue(300);
    document.body.appendChild(element);
    await element.updateComplete;
    expect(element.timestamp).toBe(300);
  });
});
