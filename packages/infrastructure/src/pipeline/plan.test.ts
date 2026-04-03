import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextNodeConfig } from "../config/schema.js";
import type { QualityTask } from "./quality.js";
import { writePlanOutputs } from "./plan.js";

describe("writePlanOutputs", () => {
	let outputFile: string;
	const originalEnv = process.env["GITHUB_OUTPUT"];

	beforeEach(() => {
		outputFile = join(
			tmpdir(),
			`gh-output-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
		);
		process.env["GITHUB_OUTPUT"] = outputFile;
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env["GITHUB_OUTPUT"];
		} else {
			process.env["GITHUB_OUTPUT"] = originalEnv;
		}
		rmSync(outputFile, { force: true });
		vi.restoreAllMocks();
	});

	const config: NextNodeConfig = {
		project: { name: "test-app", type: "app" },
		scripts: { lint: "lint", test: "test", build: "build" },
	};

	it("writes quality matrix with tasks to GITHUB_OUTPUT", () => {
		const tasks: QualityTask[] = [
			{ id: "lint", name: "Lint", cmd: "pnpm lint" },
			{ id: "test", name: "Test", cmd: "pnpm test" },
		];

		writePlanOutputs({ config, tasks });

		const output = readFileSync(outputFile, "utf-8");
		expect(output).toContain(
			`quality_matrix=${JSON.stringify([
				{ id: "lint", name: "Lint", cmd: "pnpm lint" },
				{ id: "test", name: "Test", cmd: "pnpm test" },
			])}`,
		);
		expect(output).toContain("project_name=test-app");
		expect(output).toContain("project_type=app");
	});

	it("writes skip sentinel when no tasks", () => {
		writePlanOutputs({ config, tasks: [] });

		const output = readFileSync(outputFile, "utf-8");
		expect(output).toContain(
			`quality_matrix=${JSON.stringify([{ id: "skip", name: "No quality checks", cmd: "echo skipped" }])}`,
		);
	});

	it("throws when GITHUB_OUTPUT is not set", () => {
		delete process.env["GITHUB_OUTPUT"];

		expect(() => writePlanOutputs({ config, tasks: [] })).toThrow("GITHUB_OUTPUT env var");
	});
});
