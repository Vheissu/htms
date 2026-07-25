import { CompilerError, CompilerWarning } from './types';

interface SourceLocation {
  line: number;
  column: number;
}

type Diagnostic = CompilerError | CompilerWarning;

const nodeLocations = new WeakMap<Node, SourceLocation>();

export function registerNodeLocation(
  node: Node,
  line: number,
  column: number
): void {
  nodeLocations.set(node, { line, column });
}

export function addNodeLocation<T extends Diagnostic>(
  diagnostic: T,
  node: Node
): T {
  if (diagnostic.source === 'generated') {
    return diagnostic;
  }

  const location = nodeLocations.get(node);
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

export function addNodeLocations<T extends Diagnostic>(
  diagnostics: T[],
  node: Node
): T[] {
  diagnostics.forEach((diagnostic) => addNodeLocation(diagnostic, node));
  return diagnostics;
}
