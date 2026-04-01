/**
 * Tests for NextNode Logger core functionality
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, logger, NextNodeLogger } from "@/logger.js";
import type { LoggerConfig } from "@/types.js";

import type { ConsoleMocks } from "../test-setup.js";
import { createConsoleMocks, restoreConsoleMocks } from "../test-setup.js";

describe("NextNodeLogger", () => {
	let consoleMocks: ConsoleMocks;

	beforeEach(() => {
		consoleMocks = createConsoleMocks();
	});

	afterEach(() => {
		restoreConsoleMocks(consoleMocks);
	});

	describe("constructor", () => {
		it("should create logger with default config", () => {
			const testLogger = new NextNodeLogger();
			expect(testLogger).toBeDefined();
		});

		it("should create logger with custom config", () => {
			const config: LoggerConfig = {
				prefix: "[TEST]",
				environment: "production",
				includeLocation: false,
			};
			const testLogger = new NextNodeLogger(config);
			expect(testLogger).toBeDefined();
		});
	});

	describe("debug logging", () => {
		it("should log debug message", () => {
			const testLogger = new NextNodeLogger();
			testLogger.debug("Test debug message");

			expect(consoleMocks.debug).toHaveBeenCalledWith(
				expect.stringContaining("Test debug message"),
			);
		});

		it("should not log debug when minLevel is info", () => {
			const testLogger = new NextNodeLogger({ minLevel: "info" });
			testLogger.debug("This should not appear");

			expect(consoleMocks.debug).not.toHaveBeenCalled();
		});
	});

	describe("info logging", () => {
		it("should log info message", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("Test info message");

			expect(consoleMocks.log).toHaveBeenCalledWith(
				expect.stringContaining("Test info message"),
			);
		});

		it("should log info message with object", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("Test info", {
				status: 200,
				details: { userId: 123 },
			});

			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("Test info"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("200"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("123"));
		});

		it("should log info message with scope", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("User logged in", {
				scope: "Auth",
				details: { userId: 123 },
			});

			expect(consoleMocks.log).toHaveBeenCalledWith(
				expect.stringContaining("User logged in"),
			);
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("Auth"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("123"));
		});
	});

	describe("warn logging", () => {
		it("should log warn message", () => {
			const testLogger = new NextNodeLogger();
			testLogger.warn("Test warn message");

			expect(consoleMocks.warn).toHaveBeenCalledWith(
				expect.stringContaining("Test warn message"),
			);
		});

		it("should log warn message with object", () => {
			const testLogger = new NextNodeLogger();
			testLogger.warn("Rate limit warning", {
				scope: "API",
				status: 429,
				details: { limit: 1000, current: 1001 },
			});

			expect(consoleMocks.warn).toHaveBeenCalledWith(
				expect.stringContaining("Rate limit warning"),
			);
			expect(consoleMocks.warn).toHaveBeenCalledWith(expect.stringContaining("API"));
			expect(consoleMocks.warn).toHaveBeenCalledWith(expect.stringContaining("429"));
		});
	});

	describe("error logging", () => {
		it("should log error message", () => {
			const testLogger = new NextNodeLogger();
			testLogger.error("Test error message");

			expect(consoleMocks.error).toHaveBeenCalledWith(
				expect.stringContaining("Test error message"),
			);
		});

		it("should log error message with object", () => {
			const testLogger = new NextNodeLogger();
			testLogger.error("Database error", {
				scope: "Database",
				status: 500,
				details: {
					error: "Connection timeout",
					host: "localhost",
					retries: 3,
				},
			});

			expect(consoleMocks.error).toHaveBeenCalledWith(
				expect.stringContaining("Database error"),
			);
			expect(consoleMocks.error).toHaveBeenCalledWith(expect.stringContaining("Database"));
			expect(consoleMocks.error).toHaveBeenCalledWith(expect.stringContaining("500"));
			expect(consoleMocks.error).toHaveBeenCalledWith(
				expect.stringContaining("Connection timeout"),
			);
		});
	});

	describe("log level filtering", () => {
		it("should filter logs below minLevel", () => {
			const testLogger = new NextNodeLogger({ minLevel: "warn" });

			testLogger.debug("Debug message");
			testLogger.info("Info message");
			testLogger.warn("Warn message");
			testLogger.error("Error message");

			expect(consoleMocks.debug).not.toHaveBeenCalled();
			expect(consoleMocks.log).not.toHaveBeenCalled();
			expect(consoleMocks.warn).toHaveBeenCalledOnce();
			expect(consoleMocks.error).toHaveBeenCalledOnce();
		});

		it("should only log error when minLevel is error", () => {
			const testLogger = new NextNodeLogger({ minLevel: "error" });

			testLogger.debug("Debug");
			testLogger.info("Info");
			testLogger.warn("Warn");
			testLogger.error("Error");

			expect(consoleMocks.debug).not.toHaveBeenCalled();
			expect(consoleMocks.log).not.toHaveBeenCalled();
			expect(consoleMocks.warn).not.toHaveBeenCalled();
			expect(consoleMocks.error).toHaveBeenCalledOnce();
		});
	});

	describe("silent mode", () => {
		it("should not log anything when silent is true", () => {
			const testLogger = new NextNodeLogger({ silent: true });

			testLogger.debug("Debug");
			testLogger.info("Info");
			testLogger.warn("Warn");
			testLogger.error("Error");

			expect(consoleMocks.debug).not.toHaveBeenCalled();
			expect(consoleMocks.log).not.toHaveBeenCalled();
			expect(consoleMocks.warn).not.toHaveBeenCalled();
			expect(consoleMocks.error).not.toHaveBeenCalled();
		});
	});

	describe("scope extraction", () => {
		it("should extract scope and clean object", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("Test message", {
				scope: "TestScope",
				status: 200,
				details: { data: "test" },
			});

			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("TestScope"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("200"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("test"));
		});

		it("should handle object with only scope", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("Test message", { scope: "OnlyScope" });

			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("OnlyScope"));
		});

		it("should handle object without scope", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("Test message", {
				status: 200,
				details: { data: "test" },
			});

			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("200"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("test"));
		});
	});

	describe("prefix functionality", () => {
		it("should add prefix to messages", () => {
			const testLogger = new NextNodeLogger({ prefix: "[TEST]" });
			testLogger.info("Test message");

			expect(consoleMocks.log).toHaveBeenCalledWith(
				expect.stringContaining("[TEST] Test message"),
			);
		});

		it("should add prefix to all log levels", () => {
			const testLogger = new NextNodeLogger({ prefix: "[PREFIX]" });

			testLogger.info("Info message");
			testLogger.warn("Warning message");
			testLogger.error("Error message");

			expect(consoleMocks.log).toHaveBeenCalledOnce();
			expect(consoleMocks.warn).toHaveBeenCalledOnce();
			expect(consoleMocks.error).toHaveBeenCalledOnce();

			expect(consoleMocks.log).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining("[PREFIX] Info message"),
			);
			expect(consoleMocks.warn).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining("[PREFIX] Warning message"),
			);
			expect(consoleMocks.error).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining("[PREFIX] Error message"),
			);
		});
	});

	describe("environment-specific behavior", () => {
		it.each([
			["development", { hasEmojis: true, hasJSON: false, emoji: "🔵", level: "INFO" }],
			["production", { hasEmojis: false, hasJSON: true, emoji: null, level: "info" }],
		] as const)("should format correctly for %s environment", (environment, expectations) => {
			const testLogger = new NextNodeLogger({ environment });
			testLogger.info("Test message");

			if (expectations.hasEmojis) {
				expect(consoleMocks.log).toHaveBeenCalledWith(
					expect.stringContaining(expectations.emoji!),
				);
				expect(consoleMocks.log).toHaveBeenCalledWith(
					expect.stringContaining(expectations.level),
				);
			}

			if (expectations.hasJSON) {
				expect(consoleMocks.log).toHaveBeenCalledWith(
					expect.stringMatching(/^\{.*"level"\s*:\s*"info".*\}$/),
				);
				expect(consoleMocks.log).toHaveBeenCalledWith(
					expect.stringContaining('"message":"Test message"'),
				);
			}
		});
	});

	describe("location handling", () => {
		it("should include location by default", () => {
			const testLogger = new NextNodeLogger();
			testLogger.info("Test message");

			expect(consoleMocks.log).toHaveBeenCalledOnce();
			// Should contain location information
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringMatching(/\([^)]+\)/));
		});

		it("should disable location when configured", () => {
			const testLogger = new NextNodeLogger({ includeLocation: false });
			testLogger.info("Test message");

			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("disabled"));
		});
	});

	describe("complex object handling", () => {
		it("should handle complex nested objects", () => {
			const testLogger = new NextNodeLogger();
			const complexObject = {
				scope: "Complex",
				status: 200,
				details: {
					user: {
						id: 123,
						name: "Test User",
						preferences: ["dark-mode", "notifications"],
					},
					metadata: {
						timestamp: new Date().toISOString(),
						version: "1.0.0",
					},
				},
			};

			testLogger.info("Complex object test", complexObject);

			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("Complex"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("Test User"));
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("dark-mode"));
		});

		it("should handle circular references", () => {
			const testLogger = new NextNodeLogger();
			const circularObj: Record<string, unknown> = { name: "test" };
			circularObj.self = circularObj;

			testLogger.info("Circular test", {
				scope: "Test",
				details: circularObj,
			});

			// Should not throw and should handle circular reference
			expect(consoleMocks.log).toHaveBeenCalledWith(expect.stringContaining("Test"));
		});
	});

	describe("request ID generation", () => {
		it("should include unique request IDs", () => {
			const testLogger = new NextNodeLogger();

			testLogger.info("First message");
			testLogger.info("Second message");

			expect(consoleMocks.log).toHaveBeenCalledTimes(2);

			const firstMessage = consoleMocks.log.mock.calls[0]?.[0];
			const secondMessage = consoleMocks.log.mock.calls[1]?.[0];

			// Both should have request IDs
			expect(firstMessage).toMatch(/req_[a-f0-9]{8}/);
			expect(secondMessage).toMatch(/req_[a-f0-9]{8}/);

			// Request IDs should be different
			const firstId = firstMessage.match(/req_[a-f0-9]{8}/)?.[0];
			const secondId = secondMessage.match(/req_[a-f0-9]{8}/)?.[0];
			expect(firstId).not.toBe(secondId);
		});
	});
});

describe("createLogger", () => {
	it("should create a new logger instance", () => {
		const testLogger = createLogger();
		expect(testLogger).toBeDefined();
		expect(typeof testLogger.debug).toBe("function");
		expect(typeof testLogger.info).toBe("function");
		expect(typeof testLogger.warn).toBe("function");
		expect(typeof testLogger.error).toBe("function");
	});

	it("should create logger with custom config", () => {
		const testLogger = createLogger({
			prefix: "[CUSTOM]",
			environment: "production",
		});
		expect(testLogger).toBeDefined();
	});

	it("should create independent logger instances", () => {
		const logger1 = createLogger({ prefix: "[LOGGER1]" });
		const logger2 = createLogger({ prefix: "[LOGGER2]" });

		expect(logger1).not.toBe(logger2);
	});
});

describe("default logger", () => {
	it("should export a default logger instance", () => {
		expect(logger).toBeDefined();
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
	});

	it("should be usable immediately", () => {
		const localMocks = createConsoleMocks();

		logger.info("Default logger test");

		expect(localMocks.log).toHaveBeenCalledWith(expect.stringContaining("Default logger test"));

		restoreConsoleMocks(localMocks);
	});
});
