export function handleObjectTag(element: Element): string | null {
    const objectName = element.getAttribute('name');
    if (!objectName) return null;
  
    let properties = '';
  
    for (const child of Array.from(element.children)) {
      if (child.tagName === 'PROPERTY') {
        const name = child.getAttribute('name');
        const value = child.getAttribute('value') || '';
        if (name) {
          properties += `${name}: ${value}, `;
        }
      }
    }
  
    return `const ${objectName} = {${properties}};`;
  }
