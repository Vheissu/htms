import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({
      filename: 'htms-error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'htms-combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

export class CompilerLogger {
  static logSecurityIssue(message: string, context?: Record<string, unknown>): void {
    logger.warn('Security Issue', { message, ...context });
  }

  static logValidationError(message: string, context?: Record<string, unknown>): void {
    logger.error('Validation Error', { message, ...context });
  }

  static logCompilerError(message: string, context?: Record<string, unknown>): void {
    logger.error('Compiler Error', { message, ...context });
  }

  static logPerformanceMetric(operation: string, duration: number, context?: Record<string, unknown>): void {
    logger.info('Performance Metric', { operation, duration, ...context });
  }

  static logInfo(message: string, context?: Record<string, unknown>): void {
    logger.info(message, context);
  }

  static logDebug(message: string, context?: Record<string, unknown>): void {
    logger.debug(message, context);
  }
}