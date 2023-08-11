import { handleCommentTag } from '../tags/comment';

describe('handleCommentTag', () => {
    it('converts a comment tag to a JavaScript comment', () => {
        const element = document.createElement('COMMENT');
        element.textContent = 'This is a test comment';
        const result = handleCommentTag(element);
        expect(result).toContain(`// This is a test comment`);
    });

    it('returns an empty comment line when the comment tag is empty', () => {
        const element = document.createElement('COMMENT');
        const result = handleCommentTag(element);
        expect(result).toContain('//');
    });
});
