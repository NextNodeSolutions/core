/**
 * Email Manager (FR-5, FR-7, FR-9)
 * Main facade for email operations — the primary public API
 */

import { createProvider } from "./providers/registry.js";
import { renderTemplate } from "./templates/renderer.js";
import type {
  EmailMessage,
  EmailRecipient,
  TemplatedEmailMessage,
  TemplateRenderOptions,
} from "./types/email.js";
import type { EmailProvider, ProviderConfigMap } from "./types/provider.js";
import type { SendResult } from "./types/result.js";
import { emailFail } from "./types/result.js";
import { logger } from "./utils/logger.js";

/**
 * Email manager configuration (FR-6)
 */
export interface EmailManagerConfig<P extends keyof ProviderConfigMap = "resend"> {
  /** Provider name */
  provider: P;
  /** Provider configuration */
  providerConfig: ProviderConfigMap[P];
  /** Default from address */
  defaultFrom?: string | undefined;
  /** Template render options */
  templateOptions?: TemplateRenderOptions | undefined;
}

/**
 * Email manager instance interface (FR-7)
 */
export interface EmailManager {
  /** Get the underlying provider */
  readonly provider: EmailProvider;
  /** Send an email with a React Email template */
  send: <TProps>(message: TemplatedEmailMessage<TProps>) => Promise<SendResult>;
  /** Validate provider configuration */
  validateConfig: () => Promise<boolean>;
}

/**
 * Apply default from address to recipient
 */
const resolveFrom = (
  messageFrom: EmailRecipient | undefined,
  defaultFrom: string | undefined,
): EmailRecipient | undefined => messageFrom ?? defaultFrom;

/**
 * Create an email manager instance (FR-5)
 *
 * @param config - Email manager configuration
 * @returns EmailManager instance
 *
 * @throws Error if provider configuration is invalid (EC-2: fail-fast at setup)
 * @throws Error if provider SDK is not installed
 *
 * @example
 * ```typescript
 * const emailManager = await createEmailManager({
 *   provider: 'resend',
 *   providerConfig: { apiKey: 'your-api-key' },
 *   defaultFrom: 'noreply@myapp.com',
 * })
 *
 * await emailManager.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 *   template: WelcomeEmail,
 *   props: { name: 'John' },
 * })
 * ```
 */
export async function createEmailManager<P extends keyof ProviderConfigMap>(
  config: EmailManagerConfig<P>,
): Promise<EmailManager> {
  // PERF-2: Provider client created once, reused for all sends
  const provider = await createProvider(config.provider, config.providerConfig);

  /**
   * Send an email with a React Email template (FR-9)
   */
  const send = async <TProps>(message: TemplatedEmailMessage<TProps>): Promise<SendResult> => {
    // FR-9: Apply defaultFrom if from is not provided
    const from = resolveFrom(message.from, config.defaultFrom);
    if (!from) {
      return emailFail(
        "VALIDATION_ERROR",
        'No "from" address provided and no defaultFrom configured',
      );
    }

    logger.debug("Rendering email template", {
      details: {
        recipientCount: Array.isArray(message.to) ? message.to.length : 1,
      },
    });

    // FR-9: Render template to HTML (and optionally plain text)
    const renderResult = await renderTemplate(
      message.template,
      message.props,
      config.templateOptions,
    );

    if (!renderResult.success) {
      logger.error("Template rendering failed", {
        details: { error: renderResult.error.message },
      });
      return renderResult;
    }

    // Build the internal EmailMessage
    const emailMessage: EmailMessage = {
      from,
      to: message.to,
      subject: message.subject,
      html: renderResult.data.html,
      text: renderResult.data.text,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo,
      attachments: message.attachments,
      headers: message.headers,
      tags: message.tags,
      scheduledAt: message.scheduledAt,
    };

    // Delegate to provider
    const result = await provider.send(emailMessage);

    if (result.success) {
      logger.info("Email sent successfully", {
        details: { messageId: result.data.id },
      });
    } else {
      logger.error("Email send failed", {
        details: {
          errorCode: result.error.code,
          errorMessage: result.error.message,
        },
      });
    }

    return result;
  };

  /**
   * Validate provider configuration (FR-10)
   */
  const validateConfig = async (): Promise<boolean> => provider.validateConfig();

  return {
    get provider(): EmailProvider {
      return provider;
    },
    send,
    validateConfig,
  };
}
