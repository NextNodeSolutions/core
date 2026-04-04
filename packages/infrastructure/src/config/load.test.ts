import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./load.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string): string => join(FIXTURES, name);

describe("loadConfig", () => {
	it("loads a minimal valid config with defaults", () => {
		const config = loadConfig(fixture("valid.toml"));

		expect(config.project.name).toBe("my-app");
		expect(config.project.type).toBe("app");
		expect(config.scripts.lint).toBe("lint");
		expect(config.scripts.test).toBe("test");
		expect(config.scripts.build).toBe("build");
	});

	it("loads a monorepo package config with filter", () => {
		const config = loadConfig(fixture("monorepo-package.toml"));

		expect(config.project.name).toBe("logger");
		expect(config.project.filter).toBe("@nextnode-solutions/logger");
	});

	it("defaults filter to false when not specified", () => {
		const config = loadConfig(fixture("valid.toml"));

		expect(config.project.filter).toBe(false);
	});

	it("allows overriding scripts", () => {
		const config = loadConfig(fixture("custom-scripts.toml"));

		expect(config.scripts.lint).toBe("check");
		expect(config.scripts.test).toBe(false);
		expect(config.scripts.build).toBe("build");
	});

	it("throws with all validation errors listed in message", () => {
		expect(() => loadConfig(fixture("empty.toml"))).toThrow(
			"Invalid nextnode.toml:\n  - [project] section is required",
		);
	});

	it("throws ENOENT error for missing file", () => {
		expect(() => loadConfig("/nonexistent/nextnode.toml")).toThrow("ENOENT");
	});

	it("throws on invalid TOML syntax", () => {
		expect(() => loadConfig(fixture("invalid-syntax.toml"))).toThrow("Invalid TOML document");
	});
});
