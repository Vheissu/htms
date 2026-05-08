import { TemplateNode } from './ir';

const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export function serializeTemplateNodes(
  nodes: TemplateNode[],
  targetVar: string,
  interpolationVars: string[] = []
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
        interpolationVars
      )
    );
  }
  return statements.join('\n');
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
  interpolationVars: string[]
): string[] {
  if (node.type === 'text') {
    const value = node.textContent ?? '';
    return [
      `${targetVar}.appendChild(document.createTextNode(${serializeTextValue(value, interpolationVars)}));`,
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
        `${varName}.setAttribute('${key}', ${serializeTextValue(value, interpolationVars)});`
      );
    }
  }

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      statements.push(
        ...serializeNode(child, varName, idFactory, interpolationVars)
      );
    }
  }

  statements.push(`${targetVar}.appendChild(${varName});`);
  return statements;
}

function serializeTextValue(
  value: string,
  interpolationVars: string[]
): string {
  const allowedRoots = new Set(interpolationVars);
  if (allowedRoots.size === 0) {
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

    const token = value.slice(start + 1, end);
    if (!isAllowedInterpolationToken(token, allowedRoots)) {
      searchFrom = end + 1;
      continue;
    }

    if (start > literalStart) {
      parts.push(JSON.stringify(value.slice(literalStart, start)));
    }
    parts.push(`(${token} == null ? '' : String(${token}))`);
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

function isAllowedInterpolationToken(
  token: string,
  allowedRoots: Set<string>
): boolean {
  const segments = token.split('.');
  if (segments.length === 0 || !allowedRoots.has(segments[0])) {
    return false;
  }

  return segments.every((segment) => IDENTIFIER_PATTERN.test(segment));
}
