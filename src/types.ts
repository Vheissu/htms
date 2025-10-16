import type { DirectiveNode, TemplateNode } from './component/ir';

export interface ParseOptions {
  maxFileSize?: number;
  allowedTags?: string[];
  strictMode?: boolean;
  outputFormat?: 'esm' | 'cjs' | 'iife';
  mode?: 'dom' | 'component';
}

export interface CompilerResult {
  success: boolean;
  code?: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
  components?: ComponentArtifact[];
}

export interface CompilerError {
  type: 'syntax' | 'security' | 'validation' | 'runtime';
  message: string;
  line?: number;
  column?: number;
  tag?: string;
}

export interface CompilerWarning {
  message: string;
  line?: number;
  column?: number;
  tag?: string;
}

export interface TagHandler {
  (element: Element, options?: TagHandlerOptions): HandlerResult;
}

export interface TagHandlerOptions {
  loopVariable?: string;
  parentContext?: string;
  strictMode?: boolean;
  // When set, newly created HTML elements should append to this container var
  appendTargetVar?: string;
}

export interface HandlerResult {
  code: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
  component?: {
    directives?: DirectiveNode[];
    template?: TemplateNode[];
  };
}

export interface ComponentCompileResult {
  success: boolean;
  code?: string;
  components: ComponentArtifact[];
  errors: CompilerError[];
  warnings: CompilerWarning[];
}

export interface ComponentArtifact {
  name: string;
  className: string;
  tagName: string;
  code: string;
}

export interface ValidationRule {
  name: string;
  validate: (value: string) => boolean;
  errorMessage: string;
}

export interface SecurityContext {
  allowCodeGeneration: boolean;
  allowFileSystemAccess: boolean;
  allowedFunctions: string[];
  maxComplexity: number;
}
