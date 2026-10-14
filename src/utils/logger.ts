import path from 'node:path';
import type winston from 'winston';

// File logging is opt-in: HTMS_LOG_DIR chooses the directory, otherwise a
// library import must never write log files into the consumer's CWD.
const logDirectory = process.env.HTMS_LOG_DIR;
const consoleSilent = process.env.NODE_ENV === 'test' || !process.env.LOG_LEVEL;

// With every transport silent there is nothing to format or write, so the
// logger (and winston itself, ~30ms to load) is only created when a message
// can actually go somewhere.
const enabled = !consoleSilent || Boolean(logDirectory);

let instance: winston.Logger | null = null;

function createLogger(): winston.Logger {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const winston = require('winston') as typeof import('winston');
  const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  );

  const transports: winston.transport[] = [
    new winston.transports.Console({
      silent: consoleSilent,
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

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports,
  });
}

function log(
  level: 'error' | 'warn' | 'info' | 'debug',
  message: string,
  context?: Record<string, unknown>
): void {
  if (!enabled) return;
  instance ||= createLogger();
  instance.log(level, message, context);
}

export class CompilerLogger {
  static logSecurityIssue(
    message: string,
    context?: Record<string, unknown>
  ): void {
    log('warn', 'Security Issue', { message, ...context });
  }

  static logValidationError(
    message: string,
    context?: Record<string, unknown>
  ): void {
    log('error', 'Validation Error', { message, ...context });
  }

  static logCompilerError(
    message: string,
    context?: Record<string, unknown>
  ): void {
    log('error', 'Compiler Error', { message, ...context });
  }

  static logPerformanceMetric(
    operation: string,
    duration: number,
    context?: Record<string, unknown>
  ): void {
    log('info', 'Performance Metric', { operation, duration, ...context });
  }

  static logInfo(message: string, context?: Record<string, unknown>): void {
    log('info', message, context);
  }

  static logDebug(message: string, context?: Record<string, unknown>): void {
    log('debug', message, context);
  }
}
