import { ComponentIR, TemplateNode, DirectiveNode } from '../component/ir';
import { CompilerError } from '../types';

export interface SSRRenderOptions {
  props?: Record<string, any>;
  context?: Record<string, any>;
  prettyPrint?: boolean;
}

export interface SSRRenderResult {
  html: string;
  errors: CompilerError[];
}

/**
 * Renders a component's intermediate representation to HTML string for server-side rendering.
 * This function evaluates the template nodes and directives to generate static HTML.
 */
export function renderComponentToString(
  ir: ComponentIR,
  options: SSRRenderOptions = {}
): SSRRenderResult {
  const errors: CompilerError[] = [];
  const context = { ...options.context, ...options.props };

  try {
    const html = renderTemplateNodes(ir.templateNodes, context, errors);
    return { html, errors };
  } catch (error) {
    errors.push({
      type: 'runtime',
      message: `SSR rendering failed: ${error instanceof Error ? error.message : String(error)}`
    });
    return { html: '', errors };
  }
}

function renderTemplateNodes(
  nodes: TemplateNode[],
  context: Record<string, any>,
  errors: CompilerError[]
): string {
  return nodes.map(node => renderTemplateNode(node, context, errors)).join('');
}

function renderTemplateNode(
  node: TemplateNode,
  context: Record<string, any>,
  errors: CompilerError[]
): string {
  if (node.type === 'text') {
    return escapeHtml(interpolateText(node.textContent ?? '', context));
  }

  const attrs = node.attributes
    ? Object.entries(node.attributes)
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(' ')
    : '';

  const children = node.children
    ? renderTemplateNodes(node.children, context, errors)
    : '';

  const openTag = attrs.length > 0 ? `<${node.tagName} ${attrs}>` : `<${node.tagName}>`;
  
  // Self-closing tags
  if (isSelfClosingTag(node.tagName || '')) {
    return attrs.length > 0 ? `<${node.tagName} ${attrs} />` : `<${node.tagName} />`;
  }

  return `${openTag}${children}</${node.tagName}>`;
}

function interpolateText(text: string, context: Record<string, any>): string {
  // Replace {variable} patterns with context values
  return text.replace(/\{([^}]+)\}/g, (match, varName) => {
    const trimmed = varName.trim();
    if (trimmed in context) {
      const value = context[trimmed];
      return value != null ? String(value) : '';
    }
    return match;
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSelfClosingTag(tagName: string): boolean {
  const selfClosing = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);
  return selfClosing.has(tagName.toLowerCase());
}

/**
 * Evaluates directives in a server-side context to produce initial state.
 * This is useful for pre-rendering component state during SSR.
 */
export function evaluateDirectivesForSSR(
  directives: DirectiveNode[],
  context: Record<string, any>
): Record<string, any> {
  const state: Record<string, any> = {};

  for (const directive of directives) {
    if (directive.kind === 'state' && directive.mode === 'init') {
      const path = directive.path;
      if (path.length > 0) {
        const key = path[path.length - 1];
        try {
          // Safely evaluate the initial value
          if (directive.value) {
            state[key] = evaluateExpression(directive.value, context);
          }
        } catch (error) {
          // Ignore evaluation errors in SSR context
          state[key] = undefined;
        }
      }
    }
  }

  return state;
}

function evaluateExpression(expr: string, context: Record<string, any>): any {
  try {
    // Simple JSON parsing for literals
    return JSON.parse(expr);
  } catch {
    // If not valid JSON, try to resolve from context
    if (expr in context) {
      return context[expr];
    }
    return undefined;
  }
}
