import { handlePrintTag } from '../tags/print';

describe('handlePrintTag', () => {
    it('handles PRINT tag with type attribute', () => {
        const element = document.createElement('PRINT');
        element.setAttribute('type', 'log');
        element.innerHTML = 'Hello';

        const result = handlePrintTag(element);
        expect(result).toBe('console.log(`Hello`);');
    });

    it('handles PRINT tag without type attribute (default behavior)', () => {
        const element = document.createElement('PRINT');
        element.innerHTML = 'Hello';
        const result = handlePrintTag(element);
        expect(result).toBe('console.log(`Hello`);');
    });
});
