/**
 * Logger utility for @nextnode-solutions/email-manager
 * Centralized logging with @nextnode-solutions/logger
 */

import { createLogger } from "@nextnode-solutions/logger";

/** Main library logger */
export const logger = createLogger();

/** Provider operations logger */
export const providerLogger = createLogger({
  prefix: "PROVIDER",
});
