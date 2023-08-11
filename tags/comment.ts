export function handleCommentTag(element: Element): string | null {
    return `// ${element.textContent}\r\n`;
  }