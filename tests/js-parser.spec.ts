import {
  parseProgram,
  parseReadOnlyProgram,
  withReadOnlyParseCache,
} from '../src/utils/js-parser';
import { scopeExpression } from '../src/component/scope';

describe('read-only compiler parses', () => {
  it('shares analysis trees within a compile and releases them afterwards', () => {
    const ast = withReadOnlyParseCache(() => {
      const first = parseReadOnlyProgram('count + 1', 'script');
      expect(parseReadOnlyProgram('count + 1', 'script')).toBe(first);
      return first;
    });
    expect(parseReadOnlyProgram('count + 1', 'script')).not.toBe(ast);
    withReadOnlyParseCache(() => {
      expect(parseReadOnlyProgram('count + 1', 'script')).not.toBe(ast);
    });
  });

  it('isolates mutable parses and collects comments on every request', () => {
    withReadOnlyParseCache(() => {
      const source = '// heading\ncount + 1';
      const analysis = parseReadOnlyProgram(source, 'script');
      for (let i = 0; i < 2; i++) {
        const comments: Parameters<typeof parseProgram>[2] = [];
        const mutable = parseProgram(source, 'script', comments);
        expect(mutable).not.toBe(analysis);
        expect(comments).toHaveLength(1);
        mutable.body.length = 0;
      }
      expect(analysis.body).toHaveLength(1);
    });
  });

  it('keeps module grammar separate from script grammar', () => {
    withReadOnlyParseCache(() => {
      parseReadOnlyProgram('export const value = 1', 'module');
      expect(() =>
        parseReadOnlyProgram('export const value = 1', 'script')
      ).toThrow(SyntaxError);
    });
  });

  it('restores the outer context when a nested compilation throws', () => {
    let inner: ReturnType<typeof parseReadOnlyProgram> | undefined;
    const outer = withReadOnlyParseCache(() => {
      const ast = parseReadOnlyProgram('value', 'script');
      expect(() =>
        withReadOnlyParseCache(() => {
          inner = parseReadOnlyProgram('value', 'script');
          expect(inner).not.toBe(ast);
          throw new Error('compile failed');
        })
      ).toThrow('compile failed');
      expect(parseReadOnlyProgram('value', 'script')).toBe(ast);
      return ast;
    });
    const fresh = parseReadOnlyProgram('value', 'script');
    expect(fresh).not.toBe(outer);
    expect(fresh).not.toBe(inner);
  });

  it('bounds retained source and tree counts within a large compilation', () => {
    withReadOnlyParseCache(() => {
      const large = `'${'x'.repeat(65536)}'`;
      expect(parseReadOnlyProgram(large, 'script')).not.toBe(
        parseReadOnlyProgram(large, 'script')
      );
      const first = parseReadOnlyProgram('0', 'script');
      for (let i = 1; i < 256; i++) {
        parseReadOnlyProgram(String(i), 'script');
      }
      expect(parseReadOnlyProgram('0', 'script')).toBe(first);
      expect(parseReadOnlyProgram('256', 'script')).not.toBe(
        parseReadOnlyProgram('256', 'script')
      );
    });
  });

  it('keeps scoping decisions independent when an AST is shared', () => {
    withReadOnlyParseCache(() => {
      const fields = new Set(['count']);
      expect(scopeExpression('count + 1', fields)).toBe('this.count + 1');
      expect(scopeExpression('count + 1', fields, ['count'])).toBe('count + 1');
      expect(scopeExpression('count + 1', fields)).toBe('this.count + 1');
    });
  });
});
