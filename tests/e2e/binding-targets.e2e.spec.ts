import { test, expect } from '@playwright/test';
import { ensureRuntime } from '../../dist/utils/runtime';

test('runtime bindings retain case-insensitive ID selection in quirks mode', async ({
  page,
}) => {
  await page.setContent('<html><body><span id="UPPER"></span></body></html>');
  await page.addScriptTag({ content: ensureRuntime() });
  const result = await page.evaluate(() => {
    const runtimeWindow = window as Window & {
      __htms: {
        bind(selector: string, property: string, getter: () => string): void;
      };
    };
    const cssMatch = document.querySelector('#upper');
    const idMatch = document.getElementById('upper');
    runtimeWindow.__htms.bind('#upper', 'textContent', (): string => 'bound');
    return {
      mode: document.compatMode,
      cssMatched: cssMatch !== null,
      idMatched: idMatch !== null,
      text: document.getElementById('UPPER')?.textContent,
    };
  });
  expect(result).toEqual({
    mode: 'BackCompat',
    cssMatched: true,
    idMatched: false,
    text: 'bound',
  });
});
