export interface HydrationComponent {
  id: string;
  tagName: string;
  shadowMode: 'open' | 'closed' | 'none';
  props: Record<string, unknown>;
}

export interface HydrationManifest {
  version: 1;
  components: HydrationComponent[];
}

export interface HydrationResult {
  hydrated: HTMLElement[];
  errors: string[];
}

interface HydratableElement extends HTMLElement {
  requestUpdate?: () => Promise<void>;
  updateComplete?: Promise<void>;
}

const VALID_CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/;
const UNSAFE_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

function validateManifest(parsed: unknown): HydrationManifest {
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { components?: unknown }).components)
  ) {
    throw new Error('Unsupported HTMS hydration manifest');
  }

  const manifest = parsed as HydrationManifest;
  const ids = new Set<string>();
  for (const component of manifest.components) {
    if (
      !component ||
      typeof component !== 'object' ||
      typeof component.id !== 'string' ||
      typeof component.tagName !== 'string' ||
      !VALID_CUSTOM_ELEMENT_NAME.test(component.tagName) ||
      !['open', 'closed', 'none'].includes(component.shadowMode) ||
      !component.props ||
      typeof component.props !== 'object' ||
      Array.isArray(component.props)
    ) {
      throw new Error('Invalid component entry in HTMS hydration manifest');
    }
    if (ids.has(component.id)) {
      throw new Error(
        `Duplicate hydration id "${component.id}" in HTMS hydration manifest`
      );
    }
    ids.add(component.id);
    for (const propName of Object.keys(component.props)) {
      if (UNSAFE_PROPERTY_NAMES.has(propName)) {
        throw new Error(
          `Unsafe property "${propName}" in HTMS hydration manifest`
        );
      }
    }
  }
  return manifest;
}

function readManifest(root: ParentNode): HydrationManifest {
  const scripts = Array.from(
    root.querySelectorAll<HTMLScriptElement>(
      'script[type="application/json"][data-htms-hydration]'
    )
  );
  if (scripts.length === 0) {
    throw new Error('No HTMS hydration manifest found');
  }

  const components: HydrationComponent[] = [];
  for (const script of scripts) {
    if (!script.textContent) {
      throw new Error('HTMS hydration manifest is empty');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent);
    } catch (error) {
      const manifestError = new Error(
        `Invalid HTMS hydration manifest: ${String(error)}`
      ) as Error & { cause?: unknown };
      manifestError.cause = error;
      throw manifestError;
    }
    components.push(...validateManifest(parsed).components);
  }

  return validateManifest({ version: 1, components });
}

function findHydrationTarget(
  root: ParentNode,
  component: HydrationComponent
): HydratableElement | null {
  const descendants = Array.from(
    root.querySelectorAll<HydratableElement>('[data-htms-id]')
  );
  const rootElement =
    'nodeType' in root && (root as Node).nodeType === 1
      ? (root as HydratableElement)
      : null;
  const candidates =
    rootElement?.hasAttribute('data-htms-id') === true
      ? [rootElement as HydratableElement, ...descendants]
      : descendants;
  return (
    candidates.find(
      (candidate) =>
        candidate.getAttribute('data-htms-id') === component.id &&
        candidate.localName === component.tagName
    ) ?? null
  );
}

export async function hydrate(
  root: ParentNode = document,
  manifest?: HydrationManifest
): Promise<HydrationResult> {
  const hydrationManifest = manifest
    ? validateManifest(manifest)
    : readManifest(root);
  if (hydrationManifest.version !== 1) {
    throw new Error(
      `Unsupported HTMS hydration manifest version: ${String(hydrationManifest.version)}`
    );
  }

  const hydrated: HTMLElement[] = [];
  const errors: string[] = [];

  for (const component of hydrationManifest.components) {
    const target = findHydrationTarget(root, component);
    if (!target) {
      errors.push(
        `Hydration target ${component.tagName}[data-htms-id="${component.id}"] was not found`
      );
      continue;
    }
    if (typeof target.requestUpdate !== 'function') {
      errors.push(
        `Hydration target ${component.tagName}[data-htms-id="${component.id}"] has not been upgraded; load its component bundle before hydrate()`
      );
      continue;
    }

    for (const [propName, value] of Object.entries(component.props)) {
      Reflect.set(target, propName, value);
    }

    target.removeAttribute('data-htms-ssr');
    await target.requestUpdate();
    if (target.updateComplete) {
      await target.updateComplete;
    }
    hydrated.push(target);
  }

  return { hydrated, errors };
}
