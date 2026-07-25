import { generateComponentDeclarations } from '../../src/component/declarations';
import { parseHTML } from '../../src/parser';
import ts from 'typescript';

describe('Component declarations', () => {
  it('describes typed inputs, emitted events, and tag name mappings', () => {
    const result = parseHTML(
      `
        <component
          name="typed-card"
          props="heading:string, count:number, active:boolean, data:json"
        >
          <button id="save">Save</button>
          <event target="#save" type="click">
            <emit name="card-saved" detail="this.data"></emit>
          </event>
        </component>
      `,
      { mode: 'component', strictMode: true }
    );

    expect(result.success).toBe(true);
    expect(result.components).toHaveLength(1);

    const declarations = generateComponentDeclarations(result.components ?? []);

    expect(declarations).toContain('heading: string | null;');
    expect(declarations).toContain('count: number | null;');
    expect(declarations).toContain('active: boolean;');
    expect(declarations).toContain('data: unknown | null;');
    expect(declarations).toContain('"card-saved": CustomEvent<unknown>;');
    expect(declarations).toContain('"typed-card": TypedCardComponent;');

    const files = new Map<string, string>([
      ['/typed-card.d.ts', declarations],
      [
        '/consumer.ts',
        `
          const card = document.createElement('typed-card');
          card.count = 2;
          card.active = true;
          card.addEventListener('card-saved', event => {
            const detail: unknown = event.detail;
            void detail;
          });
          void card.updateComplete;
        `,
      ],
    ]);
    const compilerOptions: ts.CompilerOptions = {
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
      types: [],
    };
    const host = ts.createCompilerHost(compilerOptions);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (fileName): boolean =>
      files.has(fileName) || fileExists(fileName);
    host.readFile = (fileName): string | undefined =>
      files.get(fileName) ?? readFile(fileName);
    host.getSourceFile = (
      fileName,
      languageVersion
    ): ts.SourceFile | undefined => {
      const contents = files.get(fileName);
      return contents === undefined
        ? getSourceFile(fileName, languageVersion)
        : ts.createSourceFile(fileName, contents, languageVersion, true);
    };
    const program = ts.createProgram({
      rootNames: Array.from(files.keys()),
      options: compilerOptions,
      host,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      )
    ).toEqual([]);
  });

  it('emits a valid module when there are no components', () => {
    expect(generateComponentDeclarations([])).toBe('export {};\n');
  });
});
