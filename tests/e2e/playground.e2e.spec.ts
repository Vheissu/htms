import { test, expect } from '@playwright/test';
import { previewDocument } from '../../src/playground/preview';

test('loads the gallery, edits and recompiles the same component', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveURL(/\/demos\/$/);
  await expect(page.locator('#compile-status')).toHaveText(
    'Compiled · 0 warning(s).'
  );
  const preview = page.frameLocator('iframe');
  await preview.getByRole('button', { name: 'Increment' }).click();
  await expect(preview.locator('#count')).toHaveText('1');
  const editor = page.getByRole('textbox', { name: 'HTMS source' });
  await editor.fill(
    (await editor.inputValue()).replace('value="0"', 'value="7"')
  );
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(preview.locator('#count')).toHaveText('7');
  await editor.press('Control+Enter');
  await expect(preview.locator('#count')).toHaveText('7');
  await expect(page.locator('#generated-code')).toContainText(
    'customElements.define'
  );
  expect(errors).toEqual([]);
  await page.locator('#playground').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/playground-desktop.png' });
});

test('loads examples, preserves drafts, resets and previews composed components', async ({
  page,
}) => {
  await page.goto('/demos/');
  const editor = page.getByRole('textbox', { name: 'HTMS source' });
  await expect(page.locator('#compile-status')).toContainText('Compiled');
  const original = await editor.inputValue();
  await editor.fill(original.replace('Increment', 'Add one'));
  await page
    .getByLabel('Example', { exact: true })
    .selectOption('composition-component');
  await expect(
    page.frameLocator('iframe').getByText('Ada Lovelace')
  ).toBeVisible();
  await expect(page.getByLabel('Preview component')).toHaveValue(
    'composition-demo'
  );
  await page.getByLabel('Preview component').selectOption('profile-card');
  await expect(
    page.frameLocator('iframe').getByText('Unnamed profile')
  ).toBeVisible();
  await page
    .getByLabel('Example', { exact: true })
    .selectOption('counter-component');
  await expect(editor).toHaveValue(original.replace('Increment', 'Add one'));
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(editor).toHaveValue(original);
  await page.locator('a[href="#example=counter-component"]').last().click();
  expect(
    await page
      .locator('#playground')
      .evaluate((el) => el.getBoundingClientRect().top)
  ).toBeLessThan(30);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('shows compiler hints, navigates to source and clears stale output', async ({
  page,
}) => {
  await page.goto('/demos/');
  await expect(page.locator('iframe')).toHaveCount(1);
  const editor = page.getByRole('textbox', { name: 'HTMS source' });
  await editor.fill(
    '<component name="broken">\n  <p>Example</p>\n</component>'
  );
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(page.locator('#compile-status')).toContainText(
    'Compilation failed'
  );
  await expect(page.locator('#diagnostics')).toContainText(
    'Custom element names need a hyphen'
  );
  await page.locator('#diagnostics button').first().click();
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart)
  ).toBe(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#generated-code')).toBeEmpty();
  await editor.fill(
    '<component name="warning-box" shadow="invalid"><p>Still works</p></component>'
  );
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(page.locator('#compile-status')).toHaveText(
    'Compiled · 1 warning(s).'
  );
  await expect(page.locator('#diagnostics')).toContainText(
    'Invalid shadow mode'
  );
  await expect(
    page.frameLocator('iframe').getByText('Still works')
  ).toBeVisible();
});

test('rejects executable markup and treats diagnostic strings as text', async ({
  page,
}) => {
  await page.goto('/demos/');
  await page
    .getByRole('textbox', { name: 'HTMS source' })
    .fill(
      '<component name="unsafe-box"><script>parent.hacked=true</script></component>'
    );
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(page.locator('#compile-status')).toContainText(
    'Compilation failed'
  );
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#diagnostics script')).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'HTMS source' })
    .fill(
      '<component name="unsafe-box" shadow="&lt;img src=x&gt;"></component>'
    );
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(page.locator('#diagnostics')).toContainText(
    'Invalid shadow mode'
  );
  await expect(page.locator('#diagnostics img')).toHaveCount(0);
});

test('isolates preview code from the parent and blocks network, storage and popups', async ({
  page,
}) => {
  await page.goto('/demos/');
  await expect(page.locator('iframe')).toHaveCount(1);
  let remoteScripts = 0;
  await page.route('https://example.com/remote.js', (route) => {
    remoteScripts += 1;
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  const html = previewDocument(
    `
    let parentBlocked = false, storageBlocked = false;
    try { parent.document.body.textContent = 'escaped'; } catch { parentBlocked = true; }
    try { localStorage.setItem('escape', 'yes'); } catch { storageBlocked = true; }
    const popupBlocked = window.open('about:blank') === null;
    const remote = document.createElement('script');
    remote.nonce = document.querySelector('script[nonce]').nonce;
    remote.src = 'https://example.com/remote.js';
    remote.onerror = () => { document.body.dataset.scriptBlocked = 'yes'; };
    document.head.append(remote);
    fetch('https://example.com/forbidden').catch(() => {
      document.body.dataset.result = JSON.stringify({parentBlocked, storageBlocked, popupBlocked, fetchBlocked: true});
    });
  `,
    'sandbox-check',
    'sandbox-test'
  );
  await expect(page.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts'
  );
  await page.locator('iframe').evaluate((el, srcdoc) => {
    (el as HTMLIFrameElement).srcdoc = srcdoc;
  }, html);
  await expect
    .poll(() =>
      page.frameLocator('iframe').locator('body').getAttribute('data-result')
    )
    .toBe(
      JSON.stringify({
        parentBlocked: true,
        storageBlocked: true,
        popupBlocked: true,
        fetchBlocked: true,
      })
    );
  await expect(
    page.getByRole('heading', { name: 'Make HTML do things.' })
  ).toBeVisible();
  await page.evaluate(() =>
    window.postMessage(
      { type: 'htms-preview', token: 'sandbox-test', error: 'forged' },
      '*'
    )
  );
  await expect(page.locator('#runtime-status')).not.toContainText('forged');
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute(
    'data-script-blocked',
    'yes'
  );
  expect(remoteScripts).toBe(0);
});

test('shows worker load failure and can recover', async ({ page }) => {
  await page.route('**/playground-worker.js', (route) => route.abort());
  await page.goto('/demos/');
  await expect(page.locator('#compile-status')).toContainText(
    'Compiler could not run'
  );
  await expect(
    page.getByRole('button', { name: 'Compile & preview' })
  ).toBeEnabled();
  await page.unroute('**/playground-worker.js');
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(
    page.frameLocator('iframe').getByRole('button', { name: 'Increment' })
  ).toBeVisible();
});

test('times out a stuck compiler and cancels stale work on input', async ({
  page,
}) => {
  await page.route('**/playground-worker.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'self.onmessage = () => {};',
    })
  );
  await page.clock.install();
  await page.goto('/demos/');
  await expect(page.locator('#compile-status')).toHaveText('Compiling…');
  await page.clock.fastForward(10_001);
  await expect(page.locator('#compile-status')).toContainText(
    'Compilation timed out'
  );
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await page
    .getByRole('textbox', { name: 'HTMS source' })
    .fill('<component name="next-example"></component>');
  await page.clock.fastForward(10_001);
  await expect(page.locator('#compile-status')).toContainText('Source changed');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('works at mobile width and loads gallery deep links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demos/#example=hello-world-component');
  await expect(
    page.frameLocator('iframe').getByText('Hello from HTMS components!')
  ).toBeVisible();
  await expect(page.getByLabel('Example', { exact: true })).toHaveValue(
    'hello-world-component'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.locator('#playground').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'output/playwright/playground-mobile.png',
    fullPage: true,
  });
});

test('compiles every gallery example in the browser', async ({ page }) => {
  await page.goto('/demos/');
  const options = await page
    .locator('#example option')
    .evaluateAll((elements) =>
      elements.map((el) => (el as HTMLOptionElement).value)
    );
  expect(options).toHaveLength(14);
  for (const example of options) {
    await page.getByLabel('Example', { exact: true }).selectOption(example);
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe(`#example=${example}`);
    await expect(page.locator('#compile-status')).toHaveText(
      /Compiled · \d+ warning\(s\)\./
    );
    await expect(page.locator('iframe')).toHaveCount(1);
  }
});

test('bounds source size and renders runtime errors without HTML injection', async ({
  page,
}) => {
  await page.goto('/demos/');
  await page
    .getByRole('textbox', { name: 'HTMS source' })
    .fill('x'.repeat(256 * 1024 + 1));
  await page.getByRole('button', { name: 'Compile & preview' }).click();
  await expect(page.locator('#compile-status')).toContainText(
    'Source is too large'
  );
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.locator('#runtime-status')).toHaveText('Preview running.');
  await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate(() => {
      window.dispatchEvent(
        new ErrorEvent('error', { message: '<img src=x onerror=alert(1)>' })
      );
    });
  await expect(page.locator('#runtime-status')).toContainText(
    'Preview error: <img'
  );
  await expect(page.locator('#runtime-status img')).toHaveCount(0);
});
