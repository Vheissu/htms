const element_counter: { [key: string]: number } = {};

export function get_unique_var_name(tag_name: string, depth: number): string {
    const key = `${tag_name}_${depth}`;
    element_counter[key] = (element_counter[key] || 0) + 1;
    return `${tag_name}_${element_counter[key]}`;
}

export function handleHtmlElement(
    element: Element,
    hostElementTarget: string = 'document.body',
    depth: number = 0
): string {
    const hostElement =
        depth === 0
            ? `const hostElement = document.querySelector('${hostElementTarget}') || document.body;`
            : '';
    const varName = get_unique_var_name(element.tagName, depth);
    let parentVarName = '';
    if (depth > 0) {
        const parent_key = `${element.parentElement?.tagName}_${depth - 1}`;
        const parent_counter = element_counter[parent_key];
        if (parent_counter !== undefined) {
            parentVarName = `${element.parentElement?.tagName}_${parent_counter}`;
        } else {
            parentVarName = hostElementTarget;
        }
    } else {
        parentVarName = hostElementTarget;
    }

    // Get tag name
    const tagName = element.tagName.toLowerCase();

    // Extract attributes
    const attributes = Array.from(element.attributes)
        .map(
            (attr) =>
                `${varName}.setAttribute('${attr.name}', '${attr.value}');`
        )
        .join('\\n');

    // Handle child elements (recursive)
    const childrenJS = Array.from(element.childNodes)
        .map((child) => {
            if (child.nodeType === 1) {
                // Element node
                return handleHtmlElement(
                    child as Element,
                    hostElementTarget,
                    depth + 1
                );
            } else if (child.nodeType === 3) {
                // Text node
                return `${varName}.appendChild(document.createTextNode(${JSON.stringify(
                    child.nodeValue
                )}));`;
            }
            return '';
        })
        .join('\\n');

    const jsCode = `
    ${hostElement} // Include the hostElement declaration
    const ${varName} = document.createElement('${tagName}');
    ${attributes}
    ${childrenJS}
    ${parentVarName}.appendChild(${varName});
`;

    return jsCode;
}
