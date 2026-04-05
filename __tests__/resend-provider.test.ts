/**
 * Resend provider tests
 * Mock Resend SDK to test request mapping, error mapping, edge cases
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProviderUtils } from "../src/providers/base.js";
import { createResendProvider } from "../src/providers/resend.js";
import { createProvider } from "../src/providers/registry.js";
import type { EmailMessage } from "../src/types/email.js";

// Mock Resend SDK
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation((apiKey: string) => ({
    emails: { send: vi.fn() },
    domains: { list: vi.fn() },
    _apiKey: apiKey,
  })),
}));

// Mock Resend client for direct provider tests
const createMockClient = () => ({
  emails: { send: vi.fn() },
  domains: { list: vi.fn() },
});

const baseMessage: EmailMessage = {
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Test Email",
  html: "<h1>Hello</h1>",
};

describe("Resend Provider", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  describe("createResendProvider", () => {
    it('creates provider with name "resend"', () => {
      const provider = createResendProvider(mockClient as never);
      expect(provider.name).toBe("resend");
    });

    it("sends email successfully", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_123" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("msg_123");
        expect(result.data.provider).toBe("resend");
        expect(result.data.sentAt).toBeInstanceOf(Date);
      }
    });

    it("maps Resend API error to failure result", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: null,
        error: { message: "Invalid API key" },
      });

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("AUTHENTICATION_ERROR");
        expect(result.error.provider).toBe("resend");
      }
    });

    it("handles no data returned from Resend", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: null,
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PROVIDER_ERROR");
      }
    });

    it("handles thrown exceptions", async () => {
      mockClient.emails.send.mockRejectedValue(new Error("Network failure"));

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("NETWORK_ERROR");
      }
    });

    it("handles recipient object format", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_456" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const message: EmailMessage = {
        from: {
          email: "sender@example.com",
          name: "Sender",
        },
        to: {
          email: "recipient@example.com",
          name: "Recipient",
        },
        subject: "Test",
        html: "<p>Hi</p>",
      };

      const result = await provider.send(message);

      expect(result.success).toBe(true);
      expect(mockClient.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Sender <sender@example.com>",
          to: ["Recipient <recipient@example.com>"],
        }),
      );
    });

    it("maps cc, bcc, replyTo recipients", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_789" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const message: EmailMessage = {
        ...baseMessage,
        cc: "cc@example.com",
        bcc: ["bcc1@example.com", "bcc2@example.com"],
        replyTo: "reply@example.com",
      };

      await provider.send(message);

      expect(mockClient.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          cc: ["cc@example.com"],
          bcc: ["bcc1@example.com", "bcc2@example.com"],
          replyTo: ["reply@example.com"],
        }),
      );
    });

    it("maps attachments with content type", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_att" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const message: EmailMessage = {
        ...baseMessage,
        attachments: [
          {
            filename: "test.pdf",
            content: Buffer.from("data"),
            contentType: "application/pdf",
          },
        ],
      };

      await provider.send(message);

      expect(mockClient.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            {
              filename: "test.pdf",
              content: Buffer.from("data"),
              content_type: "application/pdf",
            },
          ],
        }),
      );
    });

    it("maps headers and tags", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_meta" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const message: EmailMessage = {
        ...baseMessage,
        headers: [{ name: "X-Custom", value: "test" }],
        tags: [{ name: "campaign", value: "launch" }],
      };

      await provider.send(message);

      expect(mockClient.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { "X-Custom": "test" },
          tags: [{ name: "campaign", value: "launch" }],
        }),
      );
    });

    it("maps scheduledAt Date to ISO string", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_sched" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const scheduledDate = new Date("2026-03-01T10:00:00Z");
      const message: EmailMessage = {
        ...baseMessage,
        scheduledAt: scheduledDate,
      };

      await provider.send(message);

      expect(mockClient.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduled_at: scheduledDate.toISOString(),
        }),
      );
    });

    it("passes scheduledAt string as-is", async () => {
      mockClient.emails.send.mockResolvedValue({
        data: { id: "msg_sched2" },
        error: null,
      });

      const provider = createResendProvider(mockClient as never);
      const message: EmailMessage = {
        ...baseMessage,
        scheduledAt: "2026-03-01T10:00:00Z",
      };

      await provider.send(message);

      expect(mockClient.emails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduled_at: "2026-03-01T10:00:00Z",
        }),
      );
    });
  });

  describe("error mapping (FR-20)", () => {
    it("maps rate limit error", async () => {
      mockClient.emails.send.mockRejectedValue(new Error("Rate limit exceeded"));

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      if (!result.success) {
        expect(result.error.code).toBe("RATE_LIMIT_ERROR");
      }
    });

    it("maps validation error", async () => {
      mockClient.emails.send.mockRejectedValue(new Error("Validation failed"));

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("maps unknown non-Error to UNKNOWN_ERROR", async () => {
      mockClient.emails.send.mockRejectedValue("string error");

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      if (!result.success) {
        expect(result.error.code).toBe("UNKNOWN_ERROR");
      }
    });

    it("maps generic Error to PROVIDER_ERROR", async () => {
      mockClient.emails.send.mockRejectedValue(new Error("Something unexpected"));

      const provider = createResendProvider(mockClient as never);
      const result = await provider.send(baseMessage);

      if (!result.success) {
        expect(result.error.code).toBe("PROVIDER_ERROR");
      }
    });
  });

  describe("validateConfig", () => {
    it("returns true when domains.list succeeds", async () => {
      mockClient.domains.list.mockResolvedValue({
        data: [],
      });

      const provider = createResendProvider(mockClient as never);
      const isValid = await provider.validateConfig();

      expect(isValid).toBe(true);
    });

    it("returns false when domains.list throws", async () => {
      mockClient.domains.list.mockRejectedValue(new Error("Unauthorized"));

      const provider = createResendProvider(mockClient as never);
      const isValid = await provider.validateConfig();

      expect(isValid).toBe(false);
    });
  });

  describe("message validation", () => {
    it("rejects message without recipients (EC-3)", async () => {
      const provider = createResendProvider(mockClient as never);
      const message: EmailMessage = {
        from: "sender@example.com",
        to: [],
        subject: "Test",
        html: "<p>Hi</p>",
      };

      const result = await provider.send(message);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects message without content", async () => {
      const provider = createResendProvider(mockClient as never);
      const message = {
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Test",
        html: "",
      } as EmailMessage;

      const result = await provider.send(message);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
      }
    });
  });
});

describe("Provider Registry (FR-16)", () => {
  it("creates resend provider via createProvider", async () => {
    const provider = await createProvider("resend", {
      apiKey: "re_test_key",
    });
    expect(provider.name).toBe("resend");
  });

  it("throws for empty API key (EC-2)", async () => {
    await expect(createProvider("resend", { apiKey: "" })).rejects.toThrow(
      "Resend API key is required",
    );
  });

  it("throws for whitespace-only API key (EC-2)", async () => {
    await expect(createProvider("resend", { apiKey: "   " })).rejects.toThrow(
      "Resend API key is required",
    );
  });
});

describe("Provider utils (base)", () => {
  const utils = createProviderUtils("test");

  it("normalizes string recipient", () => {
    expect(utils.normalizeRecipient("user@test.com")).toBe("user@test.com");
  });

  it("normalizes object recipient with name", () => {
    expect(
      utils.normalizeRecipient({
        email: "user@test.com",
        name: "User",
      }),
    ).toBe("User <user@test.com>");
  });

  it("normalizes object recipient without name", () => {
    expect(utils.normalizeRecipient({ email: "user@test.com" })).toBe("user@test.com");
  });

  it("normalizes single recipient to array", () => {
    expect(utils.normalizeRecipients("user@test.com")).toEqual(["user@test.com"]);
  });

  it("normalizes array of recipients", () => {
    expect(utils.normalizeRecipients(["a@test.com", { email: "b@test.com", name: "B" }])).toEqual([
      "a@test.com",
      "B <b@test.com>",
    ]);
  });

  it("validates message with all required fields", () => {
    const result = utils.validateMessage(baseMessage);
    expect(result.success).toBe(true);
  });

  it("rejects message exceeding 50 recipients (EC-6)", () => {
    const recipients = Array.from({ length: 51 }, (_, i) => `user${String(i)}@test.com`);
    const result = utils.validateMessage({
      ...baseMessage,
      to: recipients,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.message).toContain("51");
      expect(result.error.message).toContain("50");
    }
  });
});
