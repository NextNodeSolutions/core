/**
 * Resend email provider
 * Implementation of EmailProvider interface for Resend
 */

import type { CreateEmailOptions, Resend } from "resend";

import type { EmailMessage } from "../types/email.js";
import type { EmailProvider } from "../types/provider.js";
import type { EmailError, SendResult } from "../types/result.js";
import { fail } from "../types/result.js";
import { providerLogger } from "../utils/logger.js";
import { createProviderUtils } from "./base.js";

const HTTP_VALIDATION_ERROR = 422;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_RATE_LIMIT = 429;

/**
 * Resend email payload type
 */
interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    content_type?: string;
  }>;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  scheduled_at?: string;
}

/**
 * Map Resend API errors to EmailError (FR-20)
 */
const mapResendError = (error: unknown): EmailError => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Check for HTTP status code patterns
    if (message.includes("rate limit") || message.includes(String(HTTP_RATE_LIMIT))) {
      return {
        code: "RATE_LIMIT_ERROR",
        message: "Rate limit exceeded",
        provider: "resend",
        originalError: error,
      };
    }

    if (
      message.includes("unauthorized") ||
      message.includes("api key") ||
      message.includes(String(HTTP_UNAUTHORIZED)) ||
      message.includes(String(HTTP_FORBIDDEN))
    ) {
      return {
        code: "AUTHENTICATION_ERROR",
        message: "Invalid API key or unauthorized",
        provider: "resend",
        originalError: error,
      };
    }

    if (message.includes("validation") || message.includes(String(HTTP_VALIDATION_ERROR))) {
      return {
        code: "VALIDATION_ERROR",
        message: error.message,
        provider: "resend",
        originalError: error,
      };
    }

    // Check for network errors
    if (
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("timeout") ||
      message.includes("fetch")
    ) {
      return {
        code: "NETWORK_ERROR",
        message: error.message,
        provider: "resend",
        originalError: error,
      };
    }

    return {
      code: "PROVIDER_ERROR",
      message: error.message,
      provider: "resend",
      originalError: error,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unknown error occurred",
    provider: "resend",
    originalError: error,
  };
};

/**
 * Create Resend email provider
 */
export const createResendProvider = (resendClient: Resend): EmailProvider => {
  const utils = createProviderUtils("resend");

  /**
   * Map optional recipients (cc, bcc, replyTo)
   */
  const mapOptionalRecipients = (
    message: EmailMessage,
  ): Pick<ResendEmailPayload, "cc" | "bcc" | "replyTo"> => ({
    ...(message.cc && {
      cc: utils.normalizeRecipients(message.cc),
    }),
    ...(message.bcc && {
      bcc: utils.normalizeRecipients(message.bcc),
    }),
    ...(message.replyTo && {
      replyTo: utils.normalizeRecipients(message.replyTo),
    }),
  });

  /**
   * Map optional content fields
   */
  const mapOptionalContent = (
    message: EmailMessage,
  ): Pick<ResendEmailPayload, "html" | "text" | "attachments"> => ({
    ...(message.html && { html: message.html }),
    ...(message.text && { text: message.text }),
    ...(message.attachments && {
      attachments: message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentType && { content_type: a.contentType }),
      })),
    }),
  });

  /**
   * Map optional metadata (headers, tags, scheduledAt)
   */
  const mapOptionalMetadata = (
    message: EmailMessage,
  ): Pick<ResendEmailPayload, "headers" | "tags" | "scheduled_at"> => ({
    ...(message.headers && {
      headers: Object.fromEntries(message.headers.map((h) => [h.name, h.value])),
    }),
    ...(message.tags && {
      tags: message.tags.map((t) => ({
        name: t.name,
        value: t.value,
      })),
    }),
    ...(message.scheduledAt && {
      scheduled_at:
        message.scheduledAt instanceof Date
          ? message.scheduledAt.toISOString()
          : message.scheduledAt,
    }),
  });

  /**
   * Map EmailMessage to Resend payload
   */
  const mapToResendPayload = (message: EmailMessage): ResendEmailPayload => ({
    from: utils.normalizeRecipient(message.from),
    to: utils.normalizeRecipients(message.to),
    subject: message.subject,
    ...mapOptionalRecipients(message),
    ...mapOptionalContent(message),
    ...mapOptionalMetadata(message),
  });

  return {
    name: "resend",

    async send(message: EmailMessage): Promise<SendResult> {
      const validation = utils.validateMessage(message);
      if (!validation.success) {
        return validation;
      }

      providerLogger.debug("Sending email via Resend", {
        details: {
          recipientCount: Array.isArray(message.to) ? message.to.length : 1,
        },
      });

      try {
        const payload = mapToResendPayload(message);
        const { data, error } = await resendClient.emails.send(payload as CreateEmailOptions);

        if (error) {
          providerLogger.error("Resend API returned error", {
            details: { errorMessage: error.message },
          });
          return fail(mapResendError(new Error(error.message)));
        }

        if (!data) {
          providerLogger.error("No data returned from Resend");
          return fail({
            code: "PROVIDER_ERROR",
            message: "No data returned from Resend",
            provider: "resend",
          });
        }

        providerLogger.info("Email sent successfully", {
          details: { messageId: data.id },
        });

        return {
          success: true,
          data: {
            id: data.id,
            provider: "resend",
            sentAt: new Date(),
          },
        };
      } catch (error) {
        providerLogger.error("Resend send failed", {
          details: {
            error: error instanceof Error ? error.message : "unknown",
          },
        });
        return fail(mapResendError(error));
      }
    },

    async validateConfig(): Promise<boolean> {
      try {
        await resendClient.domains.list();
        return true;
      } catch {
        return false;
      }
    },
  };
};
