import { TemplateNode } from './ir';

const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export function serializeTemplateNodes(
  nodes: TemplateNode[],
  targetVar: string,
  interpolationVars: string[] = [],
  componentInterpolationVars: string[] = []
): string {
  if (nodes.length === 0) {
    return '';
  }

  let counter = 0;
  const statements: string[] = [];
  for (const node of nodes) {
    statements.push(
      ...serializeNode(
        node,
        targetVar,
        () => `_el${counter++}`,
        interpolationVars,
        componentInterpolationVars
      )
    );
  }
  return statements.join('\n');
}

export function templateNodesHaveInterpolations(
  nodes: TemplateNode[],
  interpolationVars: string[] = [],
  componentInterpolationVars: string[] = []
): boolean {
  return nodes.some((node) =>
    nodeHasInterpolation(node, interpolationVars, componentInterpolationVars)
  );
}

export function templateNodesToHTML(nodes: TemplateNode[]): string {
  return nodes.map(nodeToHtml).join('');
}

function nodeToHtml(node: TemplateNode): string {
  if (node.type === 'text') {
    return escapeHtml(node.textContent ?? '');
  }

  const attrs = node.attributes
    ? Object.entries(node.attributes)
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(' ')
    : '';

  const children = node.children ? node.children.map(nodeToHtml).join('') : '';
  const openTag =
    attrs.length > 0 ? `<${node.tagName} ${attrs}>` : `<${node.tagName}>`;
  return `${openTag}${children}</${node.tagName}>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeNode(
  node: TemplateNode,
  targetVar: string,
  idFactory: () => string,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): string[] {
  if (node.type === 'text') {
    const value = node.textContent ?? '';
    return [
      `${targetVar}.appendChild(document.createTextNode(${serializeTextValue(value, interpolationVars, componentInterpolationVars)}));`,
    ];
  }

  const statements: string[] = [];
  const varName = idFactory();
  statements.push(
    `const ${varName} = document.createElement('${node.tagName}');`
  );

  if (node.attributes) {
    for (const [key, value] of Object.entries(node.attributes)) {
      statements.push(
        `${varName}.setAttribute('${key}', ${serializeTextValue(value, interpolationVars, componentInterpolationVars)});`
      );
    }
  }

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      statements.push(
        ...serializeNode(
          child,
          varName,
          idFactory,
          interpolationVars,
          componentInterpolationVars
        )
      );
    }
  }

  statements.push(`${targetVar}.appendChild(${varName});`);
  return statements;
}

function serializeTextValue(
  value: string,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): string {
  const localRoots = new Set(interpolationVars);
  const componentRoots = new Set(componentInterpolationVars);
  if (localRoots.size === 0 && componentRoots.size === 0) {
    return JSON.stringify(value);
  }

  const parts: string[] = [];
  let literalStart = 0;
  let searchFrom = 0;

  while (searchFrom < value.length) {
    const start = value.indexOf('{', searchFrom);
    if (start === -1) {
      break;
    }

    const end = value.indexOf('}', start + 1);
    if (end === -1) {
      break;
    }

    const token = value.slice(start + 1, end).trim();
    const expression = resolveInterpolationExpression(
      token,
      localRoots,
      componentRoots
    );
    if (!expression) {
      searchFrom = end + 1;
      continue;
    }

    if (start > literalStart) {
      parts.push(JSON.stringify(value.slice(literalStart, start)));
    }
    parts.push(`(${expression} == null ? '' : String(${expression}))`);
    literalStart = end + 1;
    searchFrom = end + 1;
  }

  if (parts.length === 0) {
    return JSON.stringify(value);
  }

  if (literalStart < value.length) {
    parts.push(JSON.stringify(value.slice(literalStart)));
  }

  return parts.join(' + ');
}

function nodeHasInterpolation(
  node: TemplateNode,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): boolean {
  if (node.type === 'text') {
    return textHasInterpolation(
      node.textContent ?? '',
      interpolationVars,
      componentInterpolationVars
    );
  }

  if (node.attributes) {
    for (const value of Object.values(node.attributes)) {
      if (
        textHasInterpolation(
          value,
          interpolationVars,
          componentInterpolationVars
        )
      ) {
        return true;
      }
    }
  }

  return (node.children ?? []).some((child) =>
    nodeHasInterpolation(child, interpolationVars, componentInterpolationVars)
  );
}

function textHasInterpolation(
  value: string,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): boolean {
  const localRoots = new Set(interpolationVars);
  const componentRoots = new Set(componentInterpolationVars);
  let searchFrom = 0;

  while (searchFrom < value.length) {
    const start = value.indexOf('{', searchFrom);
    if (start === -1) {
      return false;
    }

    const end = value.indexOf('}', start + 1);
    if (end === -1) {
      return false;
    }

    const token = value.slice(start + 1, end).trim();
    if (resolveInterpolationExpression(token, localRoots, componentRoots)) {
      return true;
    }

    searchFrom = end + 1;
  }

  return false;
}

function resolveInterpolationExpression(
  token: string,
  localRoots: Set<string>,
  componentRoots: Set<string>
): string | null {
  const segments = token.split('.');
  if (segments.length === 0 || segments.some((segment) => segment === '')) {
    return null;
  }

  if (!segments.every((segment) => IDENTIFIER_PATTERN.test(segment))) {
    return null;
  }

  if (localRoots.has(segments[0])) {
    return token;
  }

  if (segments[0] === 'this' && segments.length > 1) {
    return token;
  }

  if (componentRoots.has(segments[0])) {
    return `this.${token}`;
  }

  return null;
}
