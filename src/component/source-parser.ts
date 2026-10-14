import { JSDOM } from 'jsdom';
import { registerNodeLocation } from '../diagnostics';

// The HTML parser only allows table elements inside <table>, <tbody> and
// <tr>: anything else is moved in front of the table ("foster parenting"),
// and a <tr> outside a table is dropped. That breaks the natural way to
// write rows:
//
//   <tbody><repeat variable="rows" item="row"><tr>...</tr></repeat></tbody>
//
// <template> is the one element allowed everywhere in a table, and its
// content accepts rows and cells. When a source has table markup, directive
// tags are parsed as <template data-htms-directive="..."> and turned back
// into directive elements afterwards, so they keep their written position.

const TABLE_MARKUP = /<(table|thead|tbody|tfoot|tr|td|th|caption|colgroup)[\s>/]/i;

const PROTECTED_TAGS = [
  'append',
  'array',
  'bind',
  'call',
  'case',
  'class',
  'comment',
  'default',
  'derive',
  'effect',
  'else',
  'else-if',
  'elseif',
  'emit',
  'event',
  'fetch',
  'function',
  'if',
  'inject',
  'keyedlist',
  'model',
  'object',
  'print',
  'push',
  'repeat',
  'set',
  'setattr',
  'setprop',
  'show',
  'splice',
  'submit',
  'switch',
  'toggle',
  'var',
  'while',
];

const MARKER = 'data-htms-directive';

// eslint-disable-next-line security/detect-non-literal-regexp
const TAG_PATTERN = new RegExp(
  `<(/?)(${PROTECTED_TAGS.map((tag) => tag.replace('-', '\\-')).join('|')})(?=[\\s/>])`,
  'gi'
);

function protectDirectives(html: string): string {
  return html.replace(TAG_PATTERN, (_, slash: string, tag: string) =>
    slash ? '</template' : `<template ${MARKER}="${tag.toLowerCase()}"`
  );
}

function restoreDirectives(dom: JSDOM, parent: ParentNode): void {
  const document = dom.window.document;
  for (const child of Array.from(parent.children)) {
    if (
      child.localName === 'template' &&
      child.hasAttribute(MARKER) &&
      child.namespaceURI === 'http://www.w3.org/1999/xhtml'
    ) {
      const template = child as HTMLTemplateElement;
      const directive = document.createElement(
        template.getAttribute(MARKER) as string
      );
      for (const attribute of Array.from(template.attributes)) {
        if (attribute.name !== MARKER) {
          directive.setAttribute(attribute.name, attribute.value);
        }
      }
      directive.appendChild(template.content);
      const location = dom.nodeLocation(template);
      if (location) {
        registerNodeLocation(directive, location.startLine, location.startCol);
      }
      template.replaceWith(directive);
      restoreDirectives(dom, directive);
    } else {
      restoreDirectives(dom, child);
    }
  }
}

export function parseComponentSource(html: string): JSDOM {
  const protect = TABLE_MARKUP.test(html);
  const dom = new JSDOM(protect ? protectDirectives(html) : html, {
    includeNodeLocations: true,
  });
  const document = dom.window.document;
  if (protect) {
    restoreDirectives(dom, document.body);
  }
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const location = dom.nodeLocation(element);
    if (location) {
      registerNodeLocation(element, location.startLine, location.startCol);
    }
  }
  return dom;
}
