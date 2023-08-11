import { handleHtmlElement } from './html-element';
import { handleArrayTag } from './tags/array';
import { handleCallTag } from './tags/call';
import { handleCommentTag } from './tags/comment';
import { handleEventTag } from './tags/event';
import { handleFunctionTag } from './tags/function';
import { handleIfElseTags } from './tags/if-else';
import { handleInjectTag } from './tags/inject';
import { handleObjectTag } from './tags/object';
import { handlePrintTag } from './tags/print';
import { handleRepeatTag } from './tags/repeat';
import { handleSwitchTag } from './tags/switch';
import { handleVarTag } from './tags/var';

interface HandlersMapping {
    [key: string]: (element: Element, loopVariable?: string) => string | null;
}

const handlers_mapping: HandlersMapping = {
    PRINT: handlePrintTag,
    REPEAT: handleRepeatTag,
    VAR: handleVarTag,
    IF: handleIfElseTags,
    FUNCTION: handleFunctionTag,
    CALL: handleCallTag,
    SWITCH: handleSwitchTag,
    OBJECT: handleObjectTag,
    ARRAY: handleArrayTag,
    COMMENT: handleCommentTag,
    EVENT: handleEventTag,
    INJECT: handleInjectTag,
};

export function handleElement(element: Element, hostElementId?: string): string | null {
    if (isStandardHtmlElement(element) && hostElementId) {
        console.log(`Handling standard element: ${element.tagName}`);
        return handleHtmlElement(element, hostElementId);
      }

    const handlerFunction = handlers_mapping[element.tagName];
    return handlerFunction ? handlerFunction(element) : null;
}

export function isStandardHtmlElement(element: Element): boolean {
    // List of standard HTML elements we want to support
    const standardHtmlElements = [
        'input',
        'button',
        'ul',
        'li',
        'div',
        'span',
        'p',
        'h1',
        'h2',
        'h3',
        'strong',
        'a',
        'img',
        'form',
        'label',
        'select',
        'option',
        'textarea',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'nav',
        'header',
        'footer',
        'section',
        'article',
        'aside',
        'main',
        'figure',
        'figcaption',
        'audio',
        'video',
    ];

    console.log(`Element: ${element.tagName}`);

    return standardHtmlElements.includes(element.tagName.toLowerCase());
}
