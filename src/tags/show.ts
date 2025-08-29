import { TagHandler, HandlerResult, TagHandlerOptions } from '../types';
import { handleToggleTag } from './toggle';

export const handleShowTag: TagHandler = (
  element: Element,
  options: TagHandlerOptions = {}
): HandlerResult => {
  // Map: <show target="#a" when="x>5"> -> TOGGLE with condition
  if (!element.getAttribute('target')) return { code: '', errors: [{ type: 'validation', message: 'SHOW requires target', tag: 'SHOW' }], warnings: [] };
  const when = element.getAttribute('when') || element.getAttribute('condition') || 'false';
  element.setAttribute('condition', when);
  // re-use toggle implementation
  return handleToggleTag(element, options);
};

