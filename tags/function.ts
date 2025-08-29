import { handleElement } from "../handlers";

export function handleFunctionTag(element: Element): string | null {
    const functionName = element.getAttribute("name");
    const args = element.getAttribute("args") || "";
  
    if (!functionName) return null;
  
    let content = "";
  
    for (const child of Array.from(element.children)) {
      const childSnippet: string | null = handleElement(child);
      if (childSnippet) {
        // Replace {var} placeholders inside child snippets with template-safe ${var}
        content += childSnippet.replace(/\{(\w+)\}/g, (_m, p1) => `\${${p1}}`);
      }
    }
  
    return `function ${functionName}(${args}) {${content}}`;
  }
