/**
 * Provider type definitions
 * Strategy pattern interface for email providers
 */

import type { EmailMessage } from "./email.js";
import type { SendResult } from "./result.js";

/**
 * Email provider interface — Strategy pattern
 * All providers must implement this contract
 */
export interface EmailProvider {
  /** Provider name identifier */
  readonly name: string;

  /**
   * Send a single email
   */
  send(message: EmailMessage): Promise<SendResult>;

  /**
   * Validate provider configuration
   */
  validateConfig(): Promise<boolean>;
}

/**
 * Resend provider configuration
 */
export interface ResendProviderConfig {
  /** Resend API key */
  apiKey: string;
}

/**
 * Maps provider names to their config types
 */
export interface ProviderConfigMap {
  resend: ResendProviderConfig;
}
