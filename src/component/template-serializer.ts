import { TemplateNode } from './ir';

export function serializeTemplateNodes(nodes: TemplateNode[], targetVar: string): string {
  if (nodes.length === 0) {
    return '';
  }

  let counter = 0;
  const statements: string[] = [];
  for (const node of nodes) {
    statements.push(...serializeNode(node, targetVar, () => `_el${counter++}`));
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
  const openTag = attrs.length > 0 ? `<${node.tagName} ${attrs}>` : `<${node.tagName}>`;
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

function serializeNode(node: TemplateNode, targetVar: string, idFactory: () => string): string[] {
  if (node.type === 'text') {
    const value = node.textContent ?? '';
    return [`${targetVar}.appendChild(document.createTextNode(${JSON.stringify(value)}));`];
  }

  const statements: string[] = [];
  const varName = idFactory();
  statements.push(`const ${varName} = document.createElement('${node.tagName}');`);

  if (node.attributes) {
    for (const [key, value] of Object.entries(node.attributes)) {
      statements.push(`${varName}.setAttribute('${key}', ${JSON.stringify(value)});`);
    }
  }

  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      statements.push(...serializeNode(child, varName, idFactory));
    }
  }

  statements.push(`${targetVar}.appendChild(${varName});`);
  return statements;
}
