import { handleFunctionTag } from '../tags/function';

describe('handleFunctionTag', () => {
    it('converts a function tag with name and args to a JavaScript function', () => {
        const element = document.createElement('FUNCTION');
        element.setAttribute('name', 'testFunction');
        element.setAttribute('args', 'a, b');
        const result = handleFunctionTag(element);

        expect(result).toEqual('function testFunction(a, b) {}');
    });

    it('returns null when the name attribute is missing', () => {
        const element = document.createElement('FUNCTION');
        const result = handleFunctionTag(element);
        expect(result).toBeNull();
    });
});
