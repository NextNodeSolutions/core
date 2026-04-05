/**
 * Base provider utilities
 * Shared functionality for all email providers (composition pattern)
 */

import type { EmailMessage, EmailRecipient } from "../types/email.js";
import type { EmailError } from "../types/result.js";
import type { Result } from "../types/result.js";
import { emailFail } from "../types/result.js";

const MAX_RECIPIENTS = 50;

/**
 * Provider utilities returned by createProviderUtils
 */
export interface ProviderUtils {
  name: string;
  normalizeRecipient: (recipient: EmailRecipient) => string;
  normalizeRecipients: (recipients: EmailRecipient | EmailRecipient[]) => string[];
  validateMessage: (message: EmailMessage) => Result<void, EmailError>;
}

/**
 * Normalize a recipient to string format
 */
const normalizeRecipient = (recipient: EmailRecipient): string => {
  if (typeof recipient === "string") return recipient;
  return recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
};

/**
 * Normalize recipients to array of strings
 */
const normalizeRecipients = (recipients: EmailRecipient | EmailRecipient[]): string[] => {
  const arr = Array.isArray(recipients) ? recipients : [recipients];
  return arr.map(normalizeRecipient);
};

/**
 * Validate email message has required fields
 */
const validateMessage = (message: EmailMessage): Result<void, EmailError> => {
  if (!message.to) {
    return emailFail("VALIDATION_ERROR", "Missing required field: to");
  }

  if (!message.subject) {
    return emailFail("VALIDATION_ERROR", "Missing required field: subject");
  }

  if (!message.html && !message.text) {
    return emailFail("VALIDATION_ERROR", "Either html or text content is required");
  }

  // Check recipient count (EC-6)
  const toArray = Array.isArray(message.to) ? message.to : [message.to];
  if (toArray.length > MAX_RECIPIENTS) {
    return emailFail(
      "VALIDATION_ERROR",
      `Recipient count ${String(toArray.length)} exceeds maximum ${String(MAX_RECIPIENTS)}`,
    );
  }

  // Check empty recipients (EC-3)
  if (toArray.length === 0) {
    return emailFail("VALIDATION_ERROR", "No recipients specified");
  }

  return { success: true, data: undefined };
};

/**
 * Create common provider utilities
 */
export const createProviderUtils = (name: string): ProviderUtils => ({
  name,
  normalizeRecipient,
  normalizeRecipients,
  validateMessage,
});
