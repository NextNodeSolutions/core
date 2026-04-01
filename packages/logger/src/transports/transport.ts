/**
 * Transport interface for NextNode Logger
 * Defines the contract for pluggable log destinations
 */

import type { LogEntry } from "../types.js";

/**
 * Base transport interface.
 * Transports receive formatted log entries and handle their output.
 */
export interface Transport {
	/**
	 * Process a log entry.
	 * Can be synchronous or asynchronous.
	 */
	log(entry: LogEntry): void | Promise<void>;

	/**
	 * Optional cleanup method for graceful shutdown.
	 * Called when the logger is being disposed.
	 */
	dispose?(): void | Promise<void>;
}

/**
 * Transport configuration base interface.
 * Extended by specific transport implementations.
 */
export interface TransportConfig {
	/**
	 * Whether the transport is enabled.
	 * Defaults to true if not specified.
	 */
	enabled?: boolean;
}
