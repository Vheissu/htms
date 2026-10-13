import { parseHTML } from '../../src/parser';

export type MountedComponent = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<void>;
  requestUpdate(): Promise<void>;
  [key: string]: unknown;
};

let componentCounter = 0;

export function compileComponent(source: string): string {
  const result = parseHTML(source, { mode: 'component' });
  if (!result.success || !result.code) {
    throw new Error('Compilation failed: ' + JSON.stringify(result.errors));
  }
  return result.code;
}

export function runComponentCode(code: string): void {
  new Function(code.replace(/export\s*\{[^}]*\};?/g, ''))();
}

// Compiles `body` inside a uniquely named component, defines it and mounts
// one instance. Returns the element after its first render.
export async function mountComponent(
  body: string,
  componentAttributes = ''
): Promise<MountedComponent> {
  const tagName = `test-component-${++componentCounter}`;
  runComponentCode(
    compileComponent(
      `<component name="${tagName}" ${componentAttributes}>${body}</component>`
    )
  );
  const element = document.createElement(tagName) as MountedComponent;
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

export function query<T extends Element = HTMLElement>(
  element: MountedComponent,
  selector: string
): T {
  const found = element.shadowRoot.querySelector(selector);
  if (!found) {
    throw new Error(`No element matches ${selector}`);
  }
  return found as T;
}

export async function click(
  element: MountedComponent,
  selector: string
): Promise<void> {
  query(element, selector).click();
  await element.updateComplete;
}
