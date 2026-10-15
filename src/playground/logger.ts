// The playground reports CompilerResult diagnostics in its UI. Node's file
// and console transports are deliberately excluded from the browser bundle.
const silent = (): void => {};
export const CompilerLogger = {
  logSecurityIssue: silent,
  logValidationError: silent,
  logCompilerError: silent,
  logPerformanceMetric: silent,
  logInfo: silent,
  logDebug: silent,
};
