/**
 * Template renderer tests
 * Tests React Email rendering with mocked @react-email/render
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderTemplate } from "../src/templates/renderer.js";

// Mock @react-email/render
vi.mock("@react-email/render", () => ({
  render: vi.fn(),
}));

// Import the mock after vi.mock
const { render: mockRender } = await import("@react-email/render");

interface TestProps {
  name: string;
}

const testTemplate = (props: TestProps) =>
  ({ type: "div", props: { children: `Hello ${props.name}` } }) as unknown as React.ReactElement;

describe("renderTemplate (FR-11, FR-14)", () => {
  beforeEach(() => {
    vi.mocked(mockRender).mockReset();
  });

  it("renders template to HTML", async () => {
    vi.mocked(mockRender)
      .mockResolvedValueOnce("<div>Hello World</div>")
      .mockResolvedValueOnce("Hello World");

    const result = await renderTemplate(testTemplate, {
      name: "World",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.html).toBe("<div>Hello World</div>");
    }
  });

  it("generates plain text by default", async () => {
    vi.mocked(mockRender).mockResolvedValueOnce("<div>Hello</div>").mockResolvedValueOnce("Hello");

    const result = await renderTemplate(testTemplate, {
      name: "Test",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe("Hello");
    }

    // Should call render twice: HTML + plain text
    expect(mockRender).toHaveBeenCalledTimes(2);
    expect(mockRender).toHaveBeenNthCalledWith(2, expect.anything(), { plainText: true });
  });

  it("skips plain text when plainText: false", async () => {
    vi.mocked(mockRender).mockResolvedValueOnce("<div>Hi</div>");

    const result = await renderTemplate(testTemplate, { name: "Test" }, { plainText: false });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBeUndefined();
    }

    // Should only call render once (HTML only)
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("passes pretty option to render", async () => {
    vi.mocked(mockRender)
      .mockResolvedValueOnce("<div>\n  Hello\n</div>")
      .mockResolvedValueOnce("Hello");

    await renderTemplate(testTemplate, { name: "Test" }, { pretty: true });

    expect(mockRender).toHaveBeenNthCalledWith(1, expect.anything(), { pretty: true });
  });

  it("uses default options when none provided", async () => {
    vi.mocked(mockRender).mockResolvedValueOnce("<div>Hello</div>").mockResolvedValueOnce("Hello");

    await renderTemplate(testTemplate, { name: "Test" });

    // Default: pretty: false
    expect(mockRender).toHaveBeenNthCalledWith(1, expect.anything(), { pretty: false });
    // Default: plainText: true
    expect(mockRender).toHaveBeenNthCalledWith(2, expect.anything(), { plainText: true });
  });
});

describe("EC-1: Template rendering error handling", () => {
  beforeEach(() => {
    vi.mocked(mockRender).mockReset();
  });

  it("returns TEMPLATE_ERROR on rendering failure", async () => {
    vi.mocked(mockRender).mockRejectedValue(new Error("Invalid component"));

    const result = await renderTemplate(testTemplate, {
      name: "Test",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TEMPLATE_ERROR");
      expect(result.error.message).toContain("Invalid component");
      expect(result.error.originalError).toBeInstanceOf(Error);
    }
  });

  it("handles non-Error thrown values", async () => {
    vi.mocked(mockRender).mockRejectedValue("string error");

    const result = await renderTemplate(testTemplate, {
      name: "Test",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TEMPLATE_ERROR");
      expect(result.error.message).toContain("unknown error");
    }
  });

  it("handles template function that throws", async () => {
    const badTemplate = () => {
      throw new Error("Component crash");
    };

    const result = await renderTemplate(badTemplate as never, {});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TEMPLATE_ERROR");
      expect(result.error.message).toContain("Component crash");
    }
  });

  it("never throws — always returns Result", async () => {
    vi.mocked(mockRender).mockRejectedValue(new Error("Catastrophic failure"));

    // Should not throw
    const result = await renderTemplate(testTemplate, {
      name: "Test",
    });
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
  });
});
