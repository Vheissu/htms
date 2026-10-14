import { CompilerError, CompilerWarning } from './types';
import { SourceElement, SourceNode } from './source-dom';

export interface SourceLocation {
  line: number;
  column: number;
}

type Diagnostic = CompilerError | CompilerWarning;

// Locations set explicitly, and those already read from a document.
const nodeLocations = new WeakMap<SourceNode, SourceLocation>();

export function registerNodeLocation(
  node: SourceNode,
  line: number,
  column: number
): void {
  nodeLocations.set(node, { line, column });
}

export function addNodeLocation<T extends Diagnostic>(
  diagnostic: T,
  node: SourceNode
): T {
  if (diagnostic.source === 'generated') {
    return diagnostic;
  }

  const location = getNodeLocation(node);
  if (!location) {
    return diagnostic;
  }

  if (diagnostic.line === undefined) {
    diagnostic.line = location.line;
  }
  if (diagnostic.column === undefined) {
    diagnostic.column = location.column;
  }
  diagnostic.source = 'input';
  return diagnostic;
}

// Where a parsed element starts in its source. Elements parsed without
// locations are located through their document on first request.
export function getNodeLocation(node: SourceNode): SourceLocation | undefined {
  const known = nodeLocations.get(node);
  if (known || !(node instanceof SourceElement)) return known;
  const parsed = node.ownerDocument?.locationOf(node);
  if (!parsed) return undefined;
  const location = { line: parsed.startLine, column: parsed.startCol };
  nodeLocations.set(node, location);
  return location;
}

export function addNodeLocations<T extends Diagnostic>(
  diagnostics: T[],
  node: SourceNode
): T[] {
  diagnostics.forEach((diagnostic) => addNodeLocation(diagnostic, node));
  return diagnostics;
}
