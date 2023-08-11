import { handleElement } from "../handlers";

export function handleRepeatTag(element: Element): string | null {
    const count = element.getAttribute("count");
    const variable = element.getAttribute("variable");
    let loopStart: string;
    let loopVariable: string;
  
    if (variable) {
      loopStart = `for (const item of ${variable}) {`;
      loopVariable = "item";
    } else if (count) {
      loopStart = `for (let i = 0; i < ${count}; i++) {`;
      loopVariable = "i";
    } else {
      return null;
    }
  
    let content = "";
  
    for (const child of Array.from(element.children)) {
      const childSnippet: string | null = handleElement(child);
      if (childSnippet) {
        content += childSnippet.replace(/\{item\}/g, `\${${loopVariable}}`);
      }
    }
  
    return `${loopStart} ${content} }`;
  }