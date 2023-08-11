import { JSDOM } from 'jsdom';
import { handleElement } from './handlers';
import * as escodegen from 'escodegen';
import * as esprima from 'esprima';

export function getTopLevelElements(htmlContent: string): HTMLCollection {
  const dom = new JSDOM(htmlContent);
  return dom.window.document.body.children;
}

export function elementsToJsSnippets(elements: HTMLCollection): string {
  let code = '';
  for (const element of Array.from(elements)) {
    const jsSnippet: string | null = handleElement(element);
    if (jsSnippet) {
      code += jsSnippet;
    }
  }
  return code;
}

export function generateFinalJsCode(jsSnippets: string): string {
  let ast = esprima.parseScript(jsSnippets, { range: true, tokens: true, comment: true });
  ast = escodegen.attachComments(ast, ast.comments, ast.tokens);
  return escodegen.generate(ast, {
      comment: true,
      format: {
          preserveBlankLines: true
      }
  });
}

export function parseHTML(htmlContent: string): string {
  try {
    const elements = getTopLevelElements(htmlContent);
    const jsSnippets = elementsToJsSnippets(elements);
    const finalCode = generateFinalJsCode(jsSnippets);
    return finalCode;
  } catch (e: any) {
    throw new Error(`An error occurred while parsing HTML: ${e.toString()}`);
  }
}
