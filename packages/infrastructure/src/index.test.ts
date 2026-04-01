import { describe, expect, it } from "vitest";

describe("infrastructure", () => {
	it("should be importable", async () => {
		const mod = await import("./index.js");
		expect(mod).toBeDefined();
	});
});
