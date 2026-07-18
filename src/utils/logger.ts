/**
 * Winston logger with automatic daily rotation.
 * - logs/app-YYYY-MM-DD.log   : everything (info and above)
 * - logs/error-YYYY-MM-DD.log : errors only
 * - console                   : colored output for local development
 */
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { config } from '../config';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack, module }) => {
  const mod = module ? ` [${module}]` : '';
  return `${ts} ${level.toUpperCase()}${mod}: ${stack || message}`;
});

const consoleFormat = printf(({ level, message, timestamp: ts, stack, module }) => {
  const mod = module ? ` [${module}]` : '';
  return `${ts} ${level}${mod}: ${stack || message}`;
});

export const logger = winston.createLogger({
  level: config.isProduction ? 'info' : 'debug',
  format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports: [
    new DailyRotateFile({
      dirname: config.paths.logs,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
    new DailyRotateFile({
      dirname: config.paths.logs,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
    new winston.transports.Console({
      format: combine(
        colorize(),
        errors({ stack: true }),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      ),
    }),
  ],
  // Winston must never take the process down.
  exitOnError: false,
});

/** Creates a child logger tagged with a module name, e.g. [WhatsApp]. */
export function moduleLogger(moduleName: string): winston.Logger {
  return logger.child({ module: moduleName });
}
