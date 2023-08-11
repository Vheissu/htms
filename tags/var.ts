export function handleVarTag(element: Element): string | null {
    const name = element.getAttribute('name');
    const value = element.getAttribute('value') || '';

    const valueContent =
        value.startsWith('[') && value.endsWith(']') ? value : `'${value}'`;

    if (name) {
        return `const ${name} = ${valueContent};`;
    }
    return null;
}
