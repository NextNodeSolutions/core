/**
 * Provider registry
 * Factory pattern for creating email providers (FR-16)
 */

import type { EmailProvider, ProviderConfigMap } from "../types/provider.js";
import { createResendProvider } from "./resend.js";

/**
 * Create an email provider by name (FR-16)
 *
 * Provider SDKs are dynamically imported so the library doesn't crash
 * when an unused provider's package is not installed.
 *
 * @param name - Provider name
 * @param config - Provider-specific configuration
 * @returns EmailProvider instance
 *
 * @throws Error if API key is invalid format (EC-2: fail-fast at setup)
 * @throws Error if provider SDK is not installed
 */
export async function createProvider<K extends keyof ProviderConfigMap>(
  name: K,
  config: ProviderConfigMap[K],
): Promise<EmailProvider> {
  switch (name) {
    case "resend": {
      const resendConfig = config as ProviderConfigMap["resend"];

      // EC-2: Fail-fast at setup for invalid API key format
      if (!resendConfig.apiKey || resendConfig.apiKey.trim().length === 0) {
        throw new Error("Resend API key is required and cannot be empty");
      }

      let Resend: typeof import("resend").Resend;
      try {
        ({ Resend } = await import("resend"));
      } catch {
        throw new Error(
          'The "resend" package is required to use the Resend provider. Install it with: pnpm add resend',
        );
      }

      const client = new Resend(resendConfig.apiKey);
      return createResendProvider(client);
    }
    default:
      throw new Error(`Unknown provider: ${String(name)}`);
  }
}
