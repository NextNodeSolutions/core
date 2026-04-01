/**
 * Testing utilities for NextNode Logger
 * Provides spy logger and mock utilities for use in vitest/jest tests
 */

import type { LogEntry, Logger, LogLevel, LogObject, SpyLogger } from "../types.js";
import { generateRequestId } from "../utils/crypto.js";
import { parseLocation } from "../utils/location.js";
import { extractScope } from "../utils/scope.js";
import { getCurrentTimestamp } from "../utils/time.js";

/**
 * Creates a spy logger that tracks all log calls without producing any output.
 * Ideal for testing that your code logs the correct messages.
 *
 * @example
 * ```typescript
 * import { createSpyLogger } from '@nextnode/logger/testing'
 *
 * describe('MyService', () => {
 *   it('logs when creating a user', () => {
 *     const spy = createSpyLogger()
 *     const service = new MyService(spy)
 *
 *     service.createUser({ name: 'John' })
 *
 *     expect(spy.wasCalledWith('User created')).toBe(true)
 *     expect(spy.calls).toHaveLength(1)
 *     expect(spy.calls[0].level).toBe('info')
 *   })
 *
 *   afterEach(() => {
 *     spy.clear() // Reset between tests
 *   })
 * })
 * ```
 */
export const createSpyLogger = (): SpyLogger => {
	const calls: LogEntry[] = [];

	const createEntry = (level: LogLevel, message: string, object?: LogObject): LogEntry => {
		const { scope, cleanObject } = extractScope(object);

		return {
			level,
			message,
			timestamp: getCurrentTimestamp(),
			location: parseLocation(false),
			requestId: generateRequestId(),
			scope,
			object: cleanObject,
		};
	};

	const log = (level: LogLevel, message: string, object?: LogObject): void => {
		const entry = createEntry(level, message, object);
		calls.push(entry);
	};

	return {
		get calls(): LogEntry[] {
			return calls;
		},

		debug(message: string, object?: LogObject): void {
			log("debug", message, object);
		},

		info(message: string, object?: LogObject): void {
			log("info", message, object);
		},

		warn(message: string, object?: LogObject): void {
			log("warn", message, object);
		},

		error(message: string, object?: LogObject): void {
			log("error", message, object);
		},

		getCallsByLevel(level: LogLevel): LogEntry[] {
			return calls.filter((call) => call.level === level);
		},

		getLastCall(): LogEntry | undefined {
			return calls[calls.length - 1];
		},

		wasCalledWith(message: string): boolean {
			return calls.some((call) => call.message.includes(message));
		},

		wasCalledWithLevel(level: LogLevel, message: string): boolean {
			return calls.some((call) => call.level === level && call.message.includes(message));
		},

		clear(): void {
			calls.length = 0;
		},
	};
};

/**
 * Creates a no-op logger that discards all log calls.
 * Useful when you need a logger instance but don't want any output.
 *
 * @example
 * ```typescript
 * import { createNoopLogger } from '@nextnode/logger/testing'
 *
 * const service = new MyService(createNoopLogger())
 * // Service works normally but produces no log output
 * ```
 */
export const createNoopLogger = (): Logger => ({
	debug: (): void => {},
	info: (): void => {},
	warn: (): void => {},
	error: (): void => {},
});

/**
 * Mock function interface for testing
 */
interface MockFn {
	(message: string, object?: LogObject): void;
	mock: { calls: Array<[string, (LogObject | undefined)?]> };
	mockClear: () => void;
}

/**
 * Type for mock logger with trackable mock functions.
 * Each method is a mock function that can be spied on.
 */
export interface MockLogger extends Logger {
	debug: MockFn;
	info: MockFn;
	warn: MockFn;
	error: MockFn;
}

// Helper to create a mock function that works without vitest/jest
const createMockFn = (): MockFn => {
	const calls: Array<[string, (LogObject | undefined)?]> = [];
	const fn = (message: string, object?: LogObject): void => {
		calls.push([message, object]);
	};
	fn.mock = { calls };
	fn.mockClear = (): void => {
		calls.length = 0;
	};
	return fn;
};

/**
 * Creates a mock logger with trackable mock functions.
 * Works with or without vitest/jest - provides basic mock functionality.
 *
 * For full vitest/jest integration, create your own mocks:
 * ```typescript
 * const mockLogger = {
 *   debug: vi.fn(),
 *   info: vi.fn(),
 *   warn: vi.fn(),
 *   error: vi.fn(),
 * }
 * ```
 *
 * @example
 * ```typescript
 * import { createMockLogger } from '@nextnode/logger/testing'
 *
 * const mock = createMockLogger()
 * const service = new MyService(mock)
 *
 * service.doSomething()
 *
 * expect(mock.info.mock.calls).toHaveLength(1)
 * expect(mock.info.mock.calls[0][0]).toBe('Expected message')
 * ```
 */
export const createMockLogger = (): MockLogger => ({
	debug: createMockFn(),
	info: createMockFn(),
	warn: createMockFn(),
	error: createMockFn(),
});

// Re-export types for convenience
export type { LogEntry, Logger, LogLevel, LogObject, SpyLogger } from "../types.js";
