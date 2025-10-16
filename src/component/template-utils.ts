import { TemplateNode } from './ir';

export function elementToTemplateNode(element: Element): TemplateNode {
  const attributes: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    attributes[attr.name] = attr.value;
  }

  const children: TemplateNode[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? '';
      if (text.trim().length === 0) {
        continue;
      }
      children.push({ type: 'text', textContent: text });
    } else if (child.nodeType === 1) {
      const elementChild = child as Element;
      if (isLowerCaseTag(elementChild)) {
        children.push(elementToTemplateNode(elementChild));
      }
    }
  }

  return {
    type: 'element',
    tagName: element.tagName.toLowerCase(),
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    children: children.length > 0 ? children : undefined
  };
}

export function nodeListToTemplateNodes(nodes: NodeList): TemplateNode[] {
  const templateNodes: TemplateNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (text.trim().length === 0) {
        continue;
      }
      templateNodes.push({ type: 'text', textContent: text });
    } else if (node.nodeType === 1) {
      templateNodes.push(elementToTemplateNode(node as Element));
    }
  }
  return templateNodes;
}

export function isLowerCaseTag(node: Node): node is Element {
  return node.nodeType === 1 && node.nodeName === node.nodeName.toLowerCase();
}
