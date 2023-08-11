import { handleHtmlElement } from '../html-element';

describe('handleHtmlElement', () => {
    test('should handle a simple div element', () => {
        const element = document.createElement('div');
        const result = handleHtmlElement(element);
        expect(result).toContain(
            "const element0 = document.createElement('div');"
        );
        expect(result).toContain('hostElement.appendChild(element0);');
    });

    test('should handle attributes', () => {
        const element = document.createElement('input');
        element.setAttribute('type', 'text');
        element.setAttribute('placeholder', 'Enter text');
        const result = handleHtmlElement(element);
        expect(result).toContain("element0.setAttribute('type', 'text');");
        expect(result).toContain(
            "element0.setAttribute('placeholder', 'Enter text');"
        );
    });

    it('should handle nested elements', () => {
        const div = document.createElement('div');
        const span = document.createElement('span');
        span.textContent = 'Hello';
        div.appendChild(span);
        const result = handleHtmlElement(div);
        expect(result).toContain(
            "const element0 = document.createElement('div');"
        );
        expect(result).toContain(
            "const element1 = document.createElement('span');"
        );
        expect(result).toContain(
            `element1.appendChild(document.createTextNode("Hello"));`
        ); // Removed the extra quotes
        expect(result).toContain('element0.appendChild(element1);');
        expect(result).toContain('hostElement.appendChild(element0);');
    });

    test('should handle custom host element target', () => {
        const element = document.createElement('p');
        const result = handleHtmlElement(element, '#customTarget');
        expect(result).toContain(
            "const hostElement = document.querySelector('#customTarget') || document.body;"
        );
    });
});
