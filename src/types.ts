export interface ParseOptions {
  maxFileSize?: number;
  allowedTags?: string[];
  strictMode?: boolean;
  outputFormat?: 'esm' | 'cjs' | 'iife';
}

export interface CompilerResult {
  success: boolean;
  code?: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
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
}

export interface HandlerResult {
  code: string;
  errors: CompilerError[];
  warnings: CompilerWarning[];
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