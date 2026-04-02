import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./load.js";

function writeTOML(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "infra-test-"));
	const path = join(dir, "nextnode.toml");
	writeFileSync(path, content);
	return path;
}

describe("loadConfig", () => {
	it("loads a minimal valid config with defaults", () => {
		const path = writeTOML(`
[project]
name = "my-app"
type = "app"
`);
		const config = loadConfig(path);

		expect(config.project.name).toBe("my-app");
		expect(config.project.type).toBe("app");
		expect(config.scripts.lint).toBe("lint");
		expect(config.scripts.test).toBe("test");
		expect(config.scripts.build).toBe("build");
	});

	it("allows overriding scripts", () => {
		const path = writeTOML(`
[project]
name = "my-app"
type = "app"

[scripts]
lint = "check"
test = false
`);
		const config = loadConfig(path);

		expect(config.scripts.lint).toBe("check");
		expect(config.scripts.test).toBe(false);
		expect(config.scripts.build).toBe("build");
	});

	it("throws with all validation errors listed in message", () => {
		const path = writeTOML("");

		expect(() => loadConfig(path)).toThrow(
			"Invalid nextnode.toml:\n  - [project] section is required",
		);
	});

	it("throws ENOENT error for missing file", () => {
		expect(() => loadConfig("/nonexistent/nextnode.toml")).toThrow("ENOENT");
	});

	it("throws on invalid TOML syntax", () => {
		const path = writeTOML("this is not valid toml [[[");

		expect(() => loadConfig(path)).toThrow("Invalid TOML document");
	});

	it("handles config with only project section and no scripts", () => {
		const path = writeTOML(`
[project]
name = "bare-app"
type = "package"
`);
		const config = loadConfig(path);

		expect(config.project.type).toBe("package");
		expect(config.scripts.lint).toBe("lint");
	});

	it("throws with specific field errors when project is incomplete", () => {
		const path = writeTOML(`
[project]
name = "missing-type"
`);

		expect(() => loadConfig(path)).toThrow("project.type is required");
	});
});
