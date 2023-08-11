import { handleCallTag } from "../tags/call";

describe('handleCallTag', () => {
    test('should return a function', () => {
        const element = document.createElement('call');
        element.setAttribute('function', 'testFn');

        expect(handleCallTag(element)).toBe('testFn();');
    });

    test('should return a function with arguments', () => {
        const element = document.createElement('call');
        element.setAttribute('function', 'testFn');
        element.setAttribute('args', 'test1, test2');

        expect(handleCallTag(element)).toBe('testFn(test1, test2);');
    });
});
