import { handleEventTag } from '../tags/event';

describe('handleEventTag', () => {
    test('creates event listener on provided ID', () => {
        const element = document.createElement('event');
        element.setAttribute('target', '#myId');
        element.setAttribute('type', 'click');
        element.setAttribute('action', 'myCallback');

        expect(handleEventTag(element)).toBe(`document.querySelector('#myId').addEventListener('click', myCallback);`);
    });

    test('returns null if no target provided', () => {
        const element = document.createElement('event');
        element.setAttribute('type', 'click');
        element.setAttribute('action', 'myCallback');

        expect(handleEventTag(element)).toBeNull();
    });

    test('returns null if no type provided', () => {
        const element = document.createElement('event');
        element.setAttribute('target', '#myId');
        element.setAttribute('action', 'myCallback');

        expect(handleEventTag(element)).toBeNull();
    });

    test('returns null if no action provided', () => {
        const element = document.createElement('event');
        element.setAttribute('target', '#myId');
        element.setAttribute('type', 'click');

        expect(handleEventTag(element)).toBeNull();
    });
});
