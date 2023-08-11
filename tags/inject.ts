export function handleInjectTag(element: Element): string | null {
    const selector = element.getAttribute('selector');
    const content = element.innerHTML;
  
    if (!selector || !content) return null;
  
    return `
      const injectElements = document.querySelectorAll('${selector}');
      injectElements.forEach(element => {
        element.innerHTML = \`${content}\`;
      });
    `;
  }