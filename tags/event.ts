export function handleEventTag(element: Element): string | null {
    const target = element.getAttribute('target');
    const type = element.getAttribute('type');
    const action = element.getAttribute('action');
  
    if (!target || !type || !action) return null;
  
    return `document.querySelector('${target}').addEventListener('${type}', ${action});`;
  }
