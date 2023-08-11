import { getTopLevelElements, parseHTML } from '../parser';

describe('parseHTML', () => {
    it('parses a simple PRINT tag correctly', () => {
        const htmlContent = '<PRINT type="log">Hello World</PRINT>';
        const expectedJsCode = 'console.log(`Hello World`);';

        const result = parseHTML(htmlContent);

        expect(result).toBe(expectedJsCode);
    });
});

describe('getTopLevelElements', () => {
    it('extracts top-level elements from valid HTML', () => {
        const htmlContent = '<div><p>Test</p></div><span>Another Test</span>';
        const elements = getTopLevelElements(htmlContent);
        expect(elements.length).toBe(2);
    });
});
