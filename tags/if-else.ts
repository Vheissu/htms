import { handleElement } from "../handlers";

export function handleIfElseTags(element: Element): string | null {
    const condition = element.getAttribute("condition");
    if (!condition) return null;
  
    let ifContent = "";
    let elseContent = "";
  
    for (const child of Array.from(element.children)) {
      const childSnippet: string | null = handleElement(child);
      if (childSnippet) {
        ifContent += childSnippet;
      }
    }
  
    const elseElement = element.nextElementSibling;
    if (elseElement && elseElement.tagName === "ELSE") {
      for (const child of Array.from(elseElement.children)) {
        const childSnippet: string | null = handleElement(child);
        if (childSnippet) {
          elseContent += childSnippet;
        }
      }
    }
  
    return `if (${condition}) { ${ifContent} }${
      elseContent ? ` else { ${elseContent} }` : ""
    }`;
  }