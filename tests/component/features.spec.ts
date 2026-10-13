import { click, mountComponent, query } from './test-utils';

describe('directive features', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('listens on window, document and the host element', async () => {
    const element = await mountComponent(`
      <var name="keys" value="0" mutable="true"></var>
      <var name="hostClicks" value="0" mutable="true"></var>
      <p>{keys}/{hostClicks}</p>
      <event target="window" type="keydown" key="Escape"><set name="keys" op="++"></set></event>
      <event target=":host" type="ping"><set name="hostClicks" op="++"></set></event>
    `);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    element.dispatchEvent(new Event('ping'));
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('1/1');

    // Listeners are removed with the element.
    element.remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(element.keys).toBe(1);
  });

  it('sets and removes attributes from <setattr expr>', async () => {
    const element = await mountComponent(`
      <var name="busy" value="false" mutable="true"></var>
      <button id="b">Go</button>
      <setattr selector="#b" name="aria-busy" expr="busy ? 'true' : null"></setattr>
      <button id="t" on:click="busy = !busy">Toggle</button>
    `);
    expect(query(element, '#b').hasAttribute('aria-busy')).toBe(false);
    await click(element, '#t');
    expect(query(element, '#b').getAttribute('aria-busy')).toBe('true');
  });

  it('blocks javascript: URLs in dynamic attributes', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      const element = await mountComponent(
        `
        <a id="a" href="{link}">A</a>
        <a id="b" href="/static">B</a>
        <a id="c"></a>
        <setattr selector="#c" name="href" expr="link"></setattr>
      `,
        'props="link"'
      );
      // Runtime data (a prop, a fetch result) is what the guard is for.
      element.link = ['java', 'script:alert(1)'].join('');
      await element.updateComplete;
      expect(query(element, '#a').getAttribute('href')).toBe('about:blank');
      expect(query(element, '#b').getAttribute('href')).toBe('/static');
      expect(query(element, '#c').getAttribute('href')).toBe('about:blank');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('declares state with <object> and <array>', async () => {
    const element = await mountComponent(`
      <object name="user"><property name="name" value="Ada"></property></object>
      <array name="tags"><value>x</value><value>y</value></array>
      <p>{user.name}: {tags.join('+')}</p>
    `);
    expect(query(element, 'p').textContent).toBe('Ada: x+y');
  });

  it('repeats a computed number of times with a named index', async () => {
    const element = await mountComponent(`
      <var name="stars" value="2" mutable="true"></var>
      <p><repeat count="stars" index="n">[{n}]</repeat></p>
      <button on:click="stars = 3">More</button>
    `);
    expect(query(element, 'p').textContent).toBe('[0][1]');
    await click(element, 'button');
    expect(query(element, 'p').textContent).toBe('[0][1][2]');
  });

  it('honours index on literal counts', async () => {
    const element = await mountComponent(
      `<p><repeat count="2" index="n">{n}</repeat></p>`
    );
    expect(query(element, 'p').textContent).toBe('01');
  });

  it('stores numbers from <model number>', async () => {
    const element = await mountComponent(`
      <var name="qty" value="1" mutable="true"></var>
      <input id="q" type="number">
      <model selector="#q" path="qty" number="true"></model>
      <p>{typeof qty}:{qty}</p>
    `);
    const input = query<HTMLInputElement>(element, '#q');
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    await element.updateComplete;
    expect(query(element, 'p').textContent).toBe('number:7');
  });
});
