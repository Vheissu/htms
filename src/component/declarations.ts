import { ComponentArtifact, ComponentInputType } from '../types';

function declarationType(type: ComponentInputType): string {
  switch (type) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number | null';
    case 'json':
      return 'unknown | null';
    case 'string':
    default:
      return 'string | null';
  }
}

function renderComponentDeclaration(artifact: ComponentArtifact): string {
  const eventMapName = `${artifact.className}EventMap`;
  const events = [
    ...artifact.events.map((event) => ({
      name: event.name,
      type: 'CustomEvent<unknown>',
    })),
    {
      name: 'htms-error',
      type: `CustomEvent<{ error: unknown; component: ${artifact.className} }>`,
    },
  ];
  const uniqueEvents = Array.from(
    new Map(events.map((event) => [event.name, event])).values()
  );
  const eventEntries = uniqueEvents
    .map((event) => `  ${JSON.stringify(event.name)}: ${event.type};`)
    .join('\n');
  const properties = artifact.inputs
    .map((input) => `  ${input.propName}: ${declarationType(input.type)};`)
    .join('\n');

  return `export interface ${eventMapName} {
${eventEntries}
}

export declare class ${artifact.className} extends HTMLElement {
${properties ? `${properties}\n` : ''}  readonly updateComplete: Promise<void>;
  readonly renderError: unknown;
  requestUpdate(): Promise<void>;
  addEventListener<K extends keyof ${eventMapName}>(
    type: K,
    listener: (this: ${artifact.className}, event: ${eventMapName}[K]) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
}`;
}

export function generateComponentDeclarations(
  artifacts: ComponentArtifact[]
): string {
  if (artifacts.length === 0) {
    return 'export {};\n';
  }

  const declarations = artifacts.map(renderComponentDeclaration).join('\n\n');
  const tagEntries = artifacts
    .map(
      (artifact) =>
        `    ${JSON.stringify(artifact.tagName)}: ${artifact.className};`
    )
    .join('\n');

  return `${declarations}

declare global {
  interface HTMLElementTagNameMap {
${tagEntries}
  }
}
`;
}
