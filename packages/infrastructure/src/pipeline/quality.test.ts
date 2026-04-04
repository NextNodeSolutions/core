import { describe, expect, it } from "vitest";
import type { ProjectSection, ScriptsSection } from "../config/schema.js";
import { buildQualityMatrix } from "./quality.js";

const APP_PROJECT: ProjectSection = { name: "my-app", type: "app", filter: false };
const FILTERED_PROJECT: ProjectSection = { name: "my-monorepo", type: "app", filter: "@scope/app" };

describe("buildQualityMatrix", () => {
	it("builds lint and test tasks for enabled scripts", () => {
		const scripts: ScriptsSection = { lint: "lint", test: "test", build: "build" };

		const tasks = buildQualityMatrix(scripts, APP_PROJECT);

		expect(tasks).toEqual([
			{ id: "lint", name: "Lint", cmd: "pnpm lint" },
			{ id: "test", name: "Test", cmd: "pnpm test" },
		]);
	});

	it("excludes disabled scripts from the matrix", () => {
		const scripts: ScriptsSection = { lint: false, test: "test", build: "build" };

		const tasks = buildQualityMatrix(scripts, APP_PROJECT);

		expect(tasks).toEqual([{ id: "test", name: "Test", cmd: "pnpm test" }]);
	});

	it("returns empty array when all scripts are disabled", () => {
		const scripts: ScriptsSection = { lint: false, test: false, build: false };

		const tasks = buildQualityMatrix(scripts, APP_PROJECT);

		expect(tasks).toEqual([]);
	});

	it("uses custom script names in commands", () => {
		const scripts: ScriptsSection = { lint: "check:lint", test: "check:test", build: "build" };

		const tasks = buildQualityMatrix(scripts, APP_PROJECT);

		expect(tasks).toEqual([
			{ id: "lint", name: "Lint", cmd: "pnpm check:lint" },
			{ id: "test", name: "Test", cmd: "pnpm check:test" },
		]);
	});

	it("never includes build in quality matrix regardless of config", () => {
		const scripts: ScriptsSection = { lint: false, test: false, build: "build" };

		const tasks = buildQualityMatrix(scripts, APP_PROJECT);

		expect(tasks).toEqual([]);
	});

	it("handles only lint enabled", () => {
		const scripts: ScriptsSection = { lint: "lint", test: false, build: false };

		const tasks = buildQualityMatrix(scripts, APP_PROJECT);

		expect(tasks).toEqual([{ id: "lint", name: "Lint", cmd: "pnpm lint" }]);
	});

	it("uses turbo with filter when project has filter", () => {
		const scripts: ScriptsSection = { lint: "lint", test: "test", build: "build" };

		const tasks = buildQualityMatrix(scripts, FILTERED_PROJECT);

		expect(tasks).toEqual([
			{ id: "lint", name: "Lint", cmd: "pnpm turbo run lint --filter=@scope/app" },
			{ id: "test", name: "Test", cmd: "pnpm turbo run test --filter=@scope/app" },
		]);
	});
});
