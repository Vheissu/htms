import { registerNodeLocation } from '../diagnostics';
import {
  HTML_NAMESPACE,
  parseDocument,
  SourceDocument,
  SourceElement,
  SourceParentNode,
} from '../source-dom';

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

const TABLE_MARKUP =
  /<(table|thead|tbody|tfoot|tr|td|th|caption|colgroup)[\s>/]/i;

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

function restoreDirectives(
  document: SourceDocument,
  parent: SourceParentNode
): void {
  for (const child of [...parent.children]) {
    if (
      child.localName === 'template' &&
      child.hasAttribute(MARKER) &&
      child.namespaceURI === HTML_NAMESPACE
    ) {
      const directive = document.createElement(
        child.getAttribute(MARKER) as string
      );
      for (const attribute of child.attributes) {
        if (attribute.name !== MARKER) {
          directive.setAttribute(attribute.name, attribute.value);
        }
      }
      if (child.content) directive.appendChild(child.content);
      directive.sourceCodeLocation = child.sourceCodeLocation;
      child.replaceWith(directive);
      restoreDirectives(document, directive);
    } else {
      restoreDirectives(document, child);
    }
  }
}

export function parseComponentSource(html: string): SourceDocument {
  const protect = TABLE_MARKUP.test(html);
  const document = parseDocument(protect ? protectDirectives(html) : html, {
    locations: true,
  });
  if (protect && document.body) {
    restoreDirectives(document, document.body);
  }
  for (const node of document.descendants()) {
    const location = node.sourceCodeLocation;
    if (node instanceof SourceElement && location) {
      registerNodeLocation(node, location.startLine, location.startCol);
    }
  }
  return document;
}
