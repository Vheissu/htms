import { handleArrayTag } from '../tags/array';

describe('handleArrayTag', () => {
    test('creates an array of numbers', () => {
        const element = document.createElement('ARRAY');
        element.setAttribute('name', 'testarr');

        const values = ['1', '2'];
        values.forEach((value) => {
            const valueElement = document.createElement('VALUE');
            valueElement.textContent = value;
            element.appendChild(valueElement);
        });

        expect(handleArrayTag(element)).toEqual(`const testarr = [1, 2];`);
    });

    test('creates an array of strings', () => {
        const element = document.createElement('ARRAY');
        element.setAttribute('name', 'testarr');

        const values = ['test', 'test2'];
        values.forEach((value) => {
            const valueElement = document.createElement('VALUE');
            valueElement.textContent = value;
            element.appendChild(valueElement);
        });

        expect(handleArrayTag(element)).toEqual(
            `const testarr = ['test', 'test2'];`
        );
    });

    test('creates an array of booleans', () => {
        const element = document.createElement('ARRAY');
        element.setAttribute('name', 'testarr');

        const values = ['true', 'false'];
        values.forEach((value) => {
            const valueElement = document.createElement('VALUE');
            valueElement.textContent = value;
            element.appendChild(valueElement);
        });

        expect(handleArrayTag(element)).toEqual(
            `const testarr = [true, false];`
        );
    });

    test('creates a mixed array', () => {
        const element = document.createElement('ARRAY');
        element.setAttribute('name', 'testarr');

        const values = ['1', '2', 'test', 'true', 'false'];
        values.forEach((value) => {
            const valueElement = document.createElement('VALUE');
            valueElement.textContent = value;
            element.appendChild(valueElement);
        });

        expect(handleArrayTag(element)).toEqual(
            `const testarr = [1, 2, 'test', true, false];`
        );
    });
});
