export function handleArrayTag(element: Element): string | null {
    const arrayName = element.getAttribute('name');
    if (!arrayName) return null;

    const values = Array.from(element.children).reduce((acc, child) => {
        if (child.tagName === 'VALUE') {
            const value = child.textContent;
            if (typeof value === 'string') {
                if (value === 'true' || value === 'false') {
                    acc += `${value === 'true'}`;
                } else if (!isNaN(Number(value))) {
                    acc += `${Number(value)}`;
                } else {
                    try {
                        const obj = JSON.parse(value);
                        acc += `${JSON.stringify(obj)}`;
                    } catch {
                        acc += `'${value}'`;
                    }
                }
            } else {
                acc += `${value}`;
            }
            if (child.nextElementSibling) {
                acc += ', ';
            }
        }
        return acc;
    }, '');

    return `const ${arrayName} = [${values}];`;
}
