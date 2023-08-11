import { JSDOM } from 'jsdom';
import { handleRepeatTag } from '../tags/repeat';

describe('handleRepeatTag', () => {
    const { document } = new JSDOM().window;

    it('generates a loop based on the count attribute', () => {
        const element = document.createElement('REPEAT');
        element.setAttribute('count', '3');
        element.textContent = 'Hello ';
        const result = handleRepeatTag(element);
        expect(result).toBe('for (let i = 0; i < 3; i++) {  }');
    });

    it('handles REPEAT tag with missing count attribute (default behavior)', () => {
        const element = document.createElement('REPEAT');
        element.textContent = 'Hello ';
        const result = handleRepeatTag(element);
        expect(result).toBeNull();
    });

    it('handles REPEAT tag with non-numeric count attribute', () => {
        const element = document.createElement('REPEAT');
        element.setAttribute('count', 'abc');
        element.textContent = 'Hello ';
        const result = handleRepeatTag(element);
        expect(result).toBe('for (let i = 0; i < abc; i++) {  }');
    });

    it('handles REPEAT tag with empty content', () => {
        const element = document.createElement('REPEAT');
        element.setAttribute('count', '3');
        const result = handleRepeatTag(element);
        expect(result).toBe('for (let i = 0; i < 3; i++) {  }');
    });
});
