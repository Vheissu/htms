import { CompilerError, CompilerWarning } from './types';
import { SourceNode } from './source-dom';

export interface SourceLocation {
  line: number;
  column: number;
}

type Diagnostic = CompilerError | CompilerWarning;

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

export function getNodeLocation(node: SourceNode): SourceLocation | undefined {
  return nodeLocations.get(node);
}

export function addNodeLocations<T extends Diagnostic>(
  diagnostics: T[],
  node: SourceNode
): T[] {
  diagnostics.forEach((diagnostic) => addNodeLocation(diagnostic, node));
  return diagnostics;
}
