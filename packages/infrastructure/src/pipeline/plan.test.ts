import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it("writes quality matrix with tasks to GITHUB_OUTPUT", () => {
		const tasks: QualityTask[] = [
			{ id: "lint", name: "Lint", cmd: "pnpm lint" },
			{ id: "test", name: "Test", cmd: "pnpm test" },
		];

		writePlanOutputs(tasks);

		const output = readFileSync(outputFile, "utf-8");
		expect(output).toBe(
			`quality_matrix=${JSON.stringify([
				{ id: "lint", name: "Lint", cmd: "pnpm lint" },
				{ id: "test", name: "Test", cmd: "pnpm test" },
			])}\n`,
		);
	});

	it("writes skip sentinel when no tasks", () => {
		writePlanOutputs([]);

		const output = readFileSync(outputFile, "utf-8");
		expect(output).toBe(
			`quality_matrix=${JSON.stringify([{ id: "skip", name: "No quality checks", cmd: "echo skipped" }])}\n`,
		);
	});

	it("throws when GITHUB_OUTPUT is not set", () => {
		delete process.env["GITHUB_OUTPUT"];

		expect(() => writePlanOutputs([])).toThrow("GITHUB_OUTPUT env var");
	});
});
