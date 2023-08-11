import { handleElement } from "../handlers";

export function handleSwitchTag(element: Element): string | null {
    const value = element.getAttribute('value');
    if (!value) return null;
  
    let cases = '';
  
    for (const child of Array.from(element.children)) {
      if (child.tagName === 'CASE') {
        const caseValue = child.getAttribute('value') || '';
        let caseContent = '';
        for (const caseChild of Array.from(child.children)) {
          const childSnippet: string | null = handleElement(caseChild);
          if (childSnippet) {
            caseContent += childSnippet;
          }
        }
        cases += `case ${caseValue}: { ${caseContent} } break; `;
      }
    }
  
    return `switch (${value}) { ${cases} }`;
  }