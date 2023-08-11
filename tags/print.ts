export function handlePrintTag(element: Element, loopVariable?: string): string {
    const type: string = element.getAttribute("type") || "log";
    let content: string = element.textContent || "";
  
    if (loopVariable) {
      content = content.replace(/\{item\}/g, `\${${loopVariable}}`);
    }
  
    return `console.${type}(\`${content}\`);`;
  }