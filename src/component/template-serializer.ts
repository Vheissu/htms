import { DirectiveNode, TemplateNode } from './ir';
import { expressionReferences, scopeExpression } from './scope';

const IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

// Attributes that are boolean in HTML: presence means true, so a dynamic
// value must toggle the attribute rather than set a literal string.
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

// Renders an embedded directive against a target element variable. The
// returned lines use relative indentation — the caller prefixes them.
export type DirectiveChildRenderer = (
  directive: DirectiveNode,
  targetVar: string
) => string[];

export function serializeTemplateNodes(
  nodes: TemplateNode[],
  targetVar: string,
  interpolationVars: string[] = [],
  componentInterpolationVars: string[] = [],
  renderDirectiveChild?: DirectiveChildRenderer,
  nameCounter?: { value: number }
): string {
  if (nodes.length === 0) {
    return '';
  }

  const counter = nameCounter ?? { value: 0 };
  const statements: string[] = [];
  for (const node of nodes) {
    statements.push(
      ...serializeNode(
        node,
        targetVar,
        () => `_el${counter.value++}`,
        interpolationVars,
        componentInterpolationVars,
        renderDirectiveChild
      )
    );
  }
  return statements.join('\n');
}

export function templateNodesHaveInterpolations(
  nodes: TemplateNode[],
  interpolationVars: string[] = [],
  componentInterpolationVars: string[] = []
): boolean {
  return nodes.some((node) =>
    nodeHasInterpolation(node, interpolationVars, componentInterpolationVars)
  );
}

export function templateNodesHaveDirectives(nodes: TemplateNode[]): boolean {
  return nodes.some(
    (node) =>
      node.type === 'element' &&
      (node.children ?? []).some(
        (child) =>
          child.type === 'directive' ||
          (child.type === 'element' && templateNodesHaveDirectives([child]))
      )
  );
}

export function templateNodesToHTML(nodes: TemplateNode[]): string {
  return nodes.map((node) => nodeToHtml(node)).join('');
}

// Elements with no closing tag. Serializing `<br></br>` would make the HTML
// parser insert a second <br>.
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

// Raw text elements: the parser does not decode entities inside them, so
// their text must be emitted verbatim (only a closing tag needs breaking).
const RAW_TEXT_ELEMENTS = new Set(['style', 'script']);

function nodeToHtml(node: TemplateNode, parent?: TemplateNode): string {
  if (node.type === 'text') {
    const text = node.textContent ?? '';
    if (
      parent?.namespace !== 'svg' &&
      parent?.namespace !== 'mathml' &&
      RAW_TEXT_ELEMENTS.has(parent?.tagName ?? '')
    ) {
      return text.replace(/<\/(style|script)/gi, '<\\/$1');
    }
    return escapeHtml(text);
  }

  const attrs = node.attributes
    ? Object.entries(node.attributes)
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(' ')
    : '';

  const children = (node.children ?? [])
    .filter((child): child is TemplateNode => child.type !== 'directive')
    .map((child) => nodeToHtml(child, node))
    .join('');
  const openTag =
    attrs.length > 0 ? `<${node.tagName} ${attrs}>` : `<${node.tagName}>`;
  if (node.namespace === 'html' && VOID_ELEMENTS.has(node.tagName ?? '')) {
    return openTag;
  }
  return `${openTag}${children}</${node.tagName}>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeNode(
  node: TemplateNode,
  targetVar: string,
  idFactory: () => string,
  interpolationVars: string[],
  componentInterpolationVars: string[],
  renderDirectiveChild?: DirectiveChildRenderer
): string[] {
  if (node.type === 'text') {
    const value = node.textContent ?? '';
    return [
      `${targetVar}.appendChild(document.createTextNode(${serializeTextValue(value, interpolationVars, componentInterpolationVars)}));`,
    ];
  }

  const statements: string[] = [];
  const varName = idFactory();
  if (node.namespace === 'svg') {
    statements.push(
      `const ${varName} = document.createElementNS('http://www.w3.org/2000/svg', ${JSON.stringify(node.tagName ?? '')});`
    );
  } else if (node.namespace === 'mathml') {
    statements.push(
      `const ${varName} = document.createElementNS('http://www.w3.org/1998/Math/MathML', ${JSON.stringify(node.tagName ?? '')});`
    );
  } else {
    statements.push(
      `const ${varName} = document.createElement(${JSON.stringify(node.tagName ?? '')});`
    );
  }

  if (node.attributes) {
    for (const [key, value] of Object.entries(node.attributes)) {
      const attributeLiteral = JSON.stringify(key);
      if (BOOLEAN_ATTRIBUTES.has(key.toLowerCase())) {
        const toggleExpression = resolveWholeAttributeInterpolation(
          value,
          interpolationVars,
          componentInterpolationVars
        );
        if (toggleExpression) {
          statements.push(
            `if (${toggleExpression}) { ${varName}.setAttribute(${attributeLiteral}, ''); } else { ${varName}.removeAttribute(${attributeLiteral}); }`
          );
          continue;
        }
      }
      statements.push(
        `${varName}.setAttribute(${attributeLiteral}, ${serializeTextValue(value, interpolationVars, componentInterpolationVars)});`
      );
    }
  }

  if (node.children && node.children.length > 0) {
    const childTarget =
      node.namespace === 'html' && node.tagName === 'template'
        ? `${varName}.content`
        : varName;
    for (const child of node.children) {
      if (child.type === 'directive') {
        if (renderDirectiveChild) {
          statements.push(
            ...renderDirectiveChild(child.directive, childTarget)
          );
        }
        continue;
      }
      statements.push(
        ...serializeNode(
          child,
          childTarget,
          idFactory,
          interpolationVars,
          componentInterpolationVars,
          renderDirectiveChild
        )
      );
    }
  }

  statements.push(`${targetVar}.appendChild(${varName});`);
  return statements;
}

interface InterpolationToken {
  start: number;
  end: number;
  source: string;
}

// Finds the `}` closing the `{` at `start`, skipping nested braces and
// quoted strings so `{ok ? '}' : 'x'}` is one token. Returns -1 when the
// brace is never closed.
function findClosingBrace(value: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function interpolationTokens(value: string): InterpolationToken[] {
  const tokens: InterpolationToken[] = [];
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const start = value.indexOf('{', searchFrom);
    if (start === -1) break;
    const end = findClosingBrace(value, start);
    if (end === -1) break;
    tokens.push({ start, end, source: value.slice(start + 1, end).trim() });
    searchFrom = end + 1;
  }
  return tokens;
}

function serializeTextValue(
  value: string,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): string {
  const localRoots = new Set(interpolationVars);
  const componentRoots = new Set(componentInterpolationVars);
  if (localRoots.size === 0 && componentRoots.size === 0) {
    return JSON.stringify(value);
  }

  const parts: string[] = [];
  let literalStart = 0;

  for (const token of interpolationTokens(value)) {
    const expression = resolveInterpolationExpression(
      token.source,
      localRoots,
      componentRoots
    );
    if (!expression) {
      continue;
    }

    if (token.start > literalStart) {
      parts.push(JSON.stringify(value.slice(literalStart, token.start)));
    }
    parts.push(`this.__htmsToText(${expression})`);
    literalStart = token.end + 1;
  }

  if (parts.length === 0) {
    return JSON.stringify(value);
  }

  if (literalStart < value.length) {
    parts.push(JSON.stringify(value.slice(literalStart)));
  }

  return parts.join(' + ');
}

// Returns the resolved expression when the whole attribute value is a
// single "{expr}" interpolation, otherwise null.
function resolveWholeAttributeInterpolation(
  value: string,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): string | null {
  const trimmed = value.trim();
  const tokens = interpolationTokens(trimmed);
  if (
    tokens.length !== 1 ||
    tokens[0].start !== 0 ||
    tokens[0].end !== trimmed.length - 1
  ) {
    return null;
  }
  return resolveInterpolationExpression(
    tokens[0].source,
    new Set(interpolationVars),
    new Set(componentInterpolationVars)
  );
}

function nodeHasInterpolation(
  node: TemplateNode,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): boolean {
  if (node.type === 'text') {
    return textHasInterpolation(
      node.textContent ?? '',
      interpolationVars,
      componentInterpolationVars
    );
  }

  if (node.attributes) {
    for (const value of Object.values(node.attributes)) {
      if (
        textHasInterpolation(
          value,
          interpolationVars,
          componentInterpolationVars
        )
      ) {
        return true;
      }
    }
  }

  return (node.children ?? []).some(
    (child) =>
      child.type !== 'directive' &&
      nodeHasInterpolation(child, interpolationVars, componentInterpolationVars)
  );
}

function textHasInterpolation(
  value: string,
  interpolationVars: string[],
  componentInterpolationVars: string[]
): boolean {
  const localRoots = new Set(interpolationVars);
  const componentRoots = new Set(componentInterpolationVars);
  return interpolationTokens(value).some(
    (token) =>
      resolveInterpolationExpression(
        token.source,
        localRoots,
        componentRoots
      ) !== null
  );
}

function resolveInterpolationExpression(
  token: string,
  localRoots: Set<string>,
  componentRoots: Set<string>
): string | null {
  const segments = token.split('.');
  if (
    segments.length === 0 ||
    segments.some((segment) => !IDENTIFIER_PATTERN.test(segment))
  ) {
    return resolveExpressionInterpolation(token, localRoots, componentRoots);
  }

  // Paths are null-safe: `{user.name}` renders empty text while `user` is
  // still undefined instead of failing the whole render.
  if (localRoots.has(segments[0])) {
    return optionalPath(segments);
  }

  if (segments[0] === 'this' && segments.length > 1) {
    return `this.${optionalPath(segments.slice(1))}`;
  }

  if (componentRoots.has(segments[0])) {
    return `this.${optionalPath(segments)}`;
  }

  return null;
}

// `{count * 2}`, `{items.length > 0 ? 'Some' : 'None'}`, `{format(price)}`.
// Braces only interpolate when the expression reads a component field, a
// loop variable or `this`; anything else (CSS blocks, prose) stays text.
function resolveExpressionInterpolation(
  token: string,
  localRoots: Set<string>,
  componentRoots: Set<string>
): string | null {
  if (!token) {
    return null;
  }
  const references = expressionReferences(token);
  if (!references) {
    return null;
  }
  const readsScope = Array.from(references).some(
    (name) =>
      name === 'this' || localRoots.has(name) || componentRoots.has(name)
  );
  if (!readsScope) {
    return null;
  }
  return `(${scopeExpression(token, componentRoots, Array.from(localRoots))})`;
}

function optionalPath(segments: string[]): string {
  return segments.join('?.');
}
