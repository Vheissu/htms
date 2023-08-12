import { handleHtmlElement } from '../html-element';

describe('handleHtmlElement', () => {
    test('should handle a simple div element', () => {
        const element = document.createElement('div');
        const result = handleHtmlElement(element);
        expect(result).toContain(
            "const DIV_1 = document.createElement('div');"
        );
        expect(result).toContain('document.body.appendChild(DIV_1);');
    });

    test('should handle attributes', () => {
        const element = document.createElement('input');
        element.setAttribute('type', 'text');
        element.setAttribute('placeholder', 'Enter text');
        const result = handleHtmlElement(element);
        expect(result).toContain("INPUT_1.setAttribute('type', 'text');");
        expect(result).toContain(
            "INPUT_1.setAttribute('placeholder', 'Enter text');"
        );
    });

    it('should handle nested elements', () => {
        const div = document.createElement('div');
        const span = document.createElement('span');
        span.textContent = 'Hello';
        div.appendChild(span);
        const result = handleHtmlElement(div);
        expect(result).toContain(
            "const DIV_2 = document.createElement('div');"
        );
        expect(result).toContain(
            "const SPAN_1 = document.createElement('span');"
        );
        expect(result).toContain(
            `SPAN_1.appendChild(document.createTextNode("Hello"));`
        ); // Removed the extra quotes
        expect(result).toContain('DIV_2.appendChild(SPAN_1);');
        expect(result).toContain('document.body.appendChild(DIV_2);');
    });

    test('should handle custom host element target', () => {
        const element = document.createElement('p');
        const result = handleHtmlElement(element, '#customTarget');
        expect(result).toContain(
            "const hostElement = document.querySelector('#customTarget') || document.body;"
        );
    });

    test('converts a button element with onclick attribute', () => {
        const element = document.createElement('button');
        element.setAttribute('onclick', 'addTodo()');
        const result = handleHtmlElement(element);
        expect(result).toContain(
            `const BUTTON_1 = document.createElement('button');`
        );
        expect(result).toContain(
            `BUTTON_1.setAttribute('onclick', 'addTodo()');`
        );
    });

    test('converts an input element with type and placeholder attributes', () => {
        const element = document.createElement('input');
        element.setAttribute('type', 'text');
        element.setAttribute('placeholder', 'Enter new todo');
        const result = handleHtmlElement(element);
        expect(result).toContain(
            `const INPUT_2 = document.createElement('input');`
        );
        expect(result).toContain(`INPUT_2.setAttribute('type', 'text');`);
        expect(result).toContain(
            `INPUT_2.setAttribute('placeholder', 'Enter new todo');`
        );
    });

    test('converts an unordered list with list items', () => {
        const ul = document.createElement('ul');
        const li1 = document.createElement('li');
        const li2 = document.createElement('li');
        ul.appendChild(li1);
        ul.appendChild(li2);
        const result = handleHtmlElement(ul);
        expect(result).toContain(`const UL_1 = document.createElement('ul');`);
        expect(result).toContain(`const LI_1 = document.createElement('li');`);
        expect(result).toContain(`const LI_2 = document.createElement('li');`);
    });

    test('converts an image element with src attribute', () => {
        const element = document.createElement('img');
        element.setAttribute('src', 'image.jpg');
        element.setAttribute('alt', 'An Image');
        const result = handleHtmlElement(element);
        expect(result).toContain(
            `const IMG_1 = document.createElement('img');`
        );
        expect(result).toContain(`IMG_1.setAttribute('src', 'image.jpg');`);
        expect(result).toContain(`IMG_1.setAttribute('alt', 'An Image');`);
    });

    test('converts an anchor element with href attribute', () => {
        const element = document.createElement('a');
        element.setAttribute('href', 'https://example.com');
        const result = handleHtmlElement(element);
        expect(result).toContain(`const A_1 = document.createElement('a');`);
        expect(result).toContain(
            `A_1.setAttribute('href', 'https://example.com');`
        );
    });
});
