import path from 'node:path';
import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// File logging is opt-in: HTMS_LOG_DIR chooses the directory, otherwise a
// library import must never write log files into the consumer's CWD.
const logDirectory = process.env.HTMS_LOG_DIR;

const transports: winston.transport[] = [
  new winston.transports.Console({
    silent: process.env.NODE_ENV === 'test' || !process.env.LOG_LEVEL,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }),
];

if (logDirectory) {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDirectory, 'htms-error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDirectory, 'htms-combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
});

export class CompilerLogger {
  static logSecurityIssue(
    message: string,
    context?: Record<string, unknown>
  ): void {
    logger.warn('Security Issue', { message, ...context });
  }

  static logValidationError(
    message: string,
    context?: Record<string, unknown>
  ): void {
    logger.error('Validation Error', { message, ...context });
  }

  static logCompilerError(
    message: string,
    context?: Record<string, unknown>
  ): void {
    logger.error('Compiler Error', { message, ...context });
  }

  static logPerformanceMetric(
    operation: string,
    duration: number,
    context?: Record<string, unknown>
  ): void {
    logger.info('Performance Metric', { operation, duration, ...context });
  }

  static logInfo(message: string, context?: Record<string, unknown>): void {
    logger.info(message, context);
  }

  static logDebug(message: string, context?: Record<string, unknown>): void {
    logger.debug(message, context);
  }
}
