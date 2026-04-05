/**
 * Mock for @nextnode/logger
 * Provides no-op loggers for testing
 */

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export const createLogger = () => ({ ...noopLogger });
