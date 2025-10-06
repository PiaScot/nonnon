/**
 * Logging utility using Pino
 */

import pino from 'pino';
import { appConfig } from './config.js';

/**
 * Create logger instance with environment-specific configuration
 */
export const logger = pino({
  level: appConfig.nodeEnv === 'test' ? 'silent' : 'debug',
  transport:
    appConfig.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
});

/**
 * Create a child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Log types for consistency
 */
export const logInfo = (message: string, ...args: unknown[]) => logger.info(message, ...args);
export const logError = (message: string, error?: Error | unknown, ...args: unknown[]) => {
  if (error instanceof Error) {
    logger.error({ err: error, ...args }, message);
  } else {
    logger.error({ error, ...args }, message);
  }
};
export const logWarn = (message: string, ...args: unknown[]) => logger.warn(message, ...args);
export const logDebug = (message: string, ...args: unknown[]) => logger.debug(message, ...args);
export const logSuccess = (message: string, ...args: unknown[]) =>
  logger.info({ success: true, ...args }, `✅ ${message}`);
