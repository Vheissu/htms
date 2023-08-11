export function handleHtmlElement(
    element: Element,
    hostElementTarget: string = 'body',
    depth: number = 0
): string {
    const varName = `element${depth}`;
    const parentVarName = depth > 0 ? `element${depth - 1}` : '';

    // Get tag name
    const tagName = element.tagName.toLowerCase();

    // Extract attributes
    const attributes = Array.from(element.attributes)
        .map(
            (attr) =>
                `${varName}.setAttribute('${attr.name}', '${attr.value}');`
        )
        .join('\n');

    // Handle child elements (recursive)
    const childrenJS = Array.from(element.childNodes)
        .map((child) => {
            if (child.nodeType === 1) {
                // Element node
                return handleHtmlElement(
                    child as Element,
                    hostElementTarget,
                    depth + 1
                );
            } else if (child.nodeType === 3) {
                // Text node
                return `${varName}.appendChild(document.createTextNode(${JSON.stringify(
                    child.nodeValue
                )}));`;
            }
            return '';
        })
        .join('\n');

    // Create JavaScript code for the element
    const jsCode = `
      const ${varName} = document.createElement('${tagName}');
      ${attributes}
      ${childrenJS}
      ${
          parentVarName
              ? `${parentVarName}.appendChild(${varName});`
              : `const hostElement = document.querySelector('${hostElementTarget}') || document.body; hostElement.appendChild(${varName});`
      }
    `;

    return jsCode;
}
