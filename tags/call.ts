export function handleCallTag(element: Element): string | null {
    const functionName = element.getAttribute('function');
    const args = element.getAttribute('args') || '';

    if (!functionName) return null;

    return `${functionName}(${args});`;
}
