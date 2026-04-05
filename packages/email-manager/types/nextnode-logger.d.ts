/**
 * Type declarations for @nextnode-solutions/logger
 * Used during development when the package is linked locally without dist
 */
declare module "@nextnode-solutions/logger" {
  export interface LogObject {
    readonly scope?: string;
    readonly details?: unknown;
    readonly status?: number;
    readonly [key: string]: unknown;
  }

  export interface Logger {
    debug(message: string, object?: LogObject): void;
    info(message: string, object?: LogObject): void;
    warn(message: string, object?: LogObject): void;
    error(message: string, object?: LogObject): void;
  }

  export interface LoggerConfig {
    readonly prefix?: string;
    readonly environment?: "development" | "production";
    readonly includeLocation?: boolean;
    readonly minLevel?: "debug" | "info" | "warn" | "error";
    readonly silent?: boolean;
  }

  export function createLogger(config?: LoggerConfig): Logger;
}
