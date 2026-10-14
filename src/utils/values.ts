import { parseExpressionPrefix } from './js-parser';
import { SecurityValidator } from './security';

// Returns the decoded value when `raw` is exactly one quoted JavaScript
// string literal ('text' or "text"), otherwise null.
export function parseQuotedString(raw: string): string | null {
  const value = raw.trim();
  if (
    value.length < 2 ||
    !(
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    )
  ) {
    return null;
  }
  // Anything else that parses, e.g. 'a' + 'b', is not a single literal.
  const prefix = parseExpressionPrefix(value);
  if (
    prefix &&
    prefix.expression.type === 'Literal' &&
    typeof prefix.expression.value === 'string' &&
    prefix.end === value.length
  ) {
    return prefix.expression.value;
  }
  return null;
}

// Parses a JSON array/object attribute value. Returns the re-serialized JSON
// or null when the value is not JSON of the expected shape.
export function parseJsonLiteral(raw: string): string | null {
  const value = raw.trim();
  const looksLikeArray = value.startsWith('[') && value.endsWith(']');
  const looksLikeObject = value.startsWith('{') && value.endsWith('}');
  if (!looksLikeArray && !looksLikeObject) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

export interface ValueAttributeOptions {
  // Identifier paths are references only when this returns true for their
  // root (or when no predicate is supplied). Otherwise they are plain text,
  // so value="done" means the string "done" unless `done` is a known field.
  isReference?: (root: string) => boolean;
  // When false, identifier paths are always plain text.
  allowReferences?: boolean;
}

// Converts a literal-style `value` attribute into a JavaScript expression.
// Quoted strings, numbers, booleans, null, JSON and (known) identifier paths
// keep their JavaScript meaning; anything else is treated as plain text.
export function valueAttributeToExpression(
  raw: string,
  options: ValueAttributeOptions = {}
): string {
  const value = raw.trim();
  if (!value) {
    return 'undefined';
  }

  const quoted = parseQuotedString(value);
  if (quoted !== null) {
    return JSON.stringify(quoted);
  }

  if (SecurityValidator.isNumericLiteral(value)) {
    return value;
  }

  if (
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    value === 'undefined'
  ) {
    return value;
  }

  const json = parseJsonLiteral(value);
  if (json !== null) {
    return json;
  }

  if (
    options.allowReferences !== false &&
    SecurityValidator.isJavaScriptPath(value)
  ) {
    const root = value.split('.')[0];
    if (root === 'this' || !options.isReference || options.isReference(root)) {
      return value;
    }
  }

  return SecurityValidator.jsStringLiteral(raw);
}
