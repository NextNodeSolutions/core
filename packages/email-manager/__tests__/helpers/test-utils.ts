/**
 * Test utilities
 * Mock provider and test message factories
 */
import { vi } from "vitest";

import type { EmailMessage, TemplatedEmailMessage } from "../../src/types/email.js";
import type { EmailProvider } from "../../src/types/provider.js";
import type { SendResult } from "../../src/types/result.js";

/**
 * Create a mock EmailProvider
 */
export function createMockProvider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    name: "mock",
    send: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: "mock_msg_id",
        provider: "mock",
        sentAt: new Date(),
      },
    } satisfies SendResult),
    validateConfig: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/**
 * Create a test EmailMessage
 */
export function createTestMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: "sender@test.com",
    to: "recipient@test.com",
    subject: "Test Email",
    html: "<p>Hello</p>",
    ...overrides,
  };
}

/**
 * Create a test TemplatedEmailMessage
 */
export function createTestTemplatedMessage<TProps = { name: string }>(
  overrides: Partial<TemplatedEmailMessage<TProps>> = {},
): TemplatedEmailMessage<TProps> {
  return {
    to: "recipient@test.com",
    subject: "Test Email",
    template: (() => null) as never,
    props: { name: "Test" } as TProps,
    ...overrides,
  };
}
