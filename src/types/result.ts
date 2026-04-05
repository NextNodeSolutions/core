/**
 * Result type definitions
 * Discriminated unions for type-safe error handling
 */

/**
 * Base result type — discriminated union for success/error
 */
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

/**
 * Email error codes
 */
export type EmailErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "RATE_LIMIT_ERROR"
  | "PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "TEMPLATE_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Email send error with details
 */
export interface EmailError {
  /** Error code */
  code: EmailErrorCode;
  /** Human-readable message */
  message: string;
  /** Provider name if applicable */
  provider?: string | undefined;
  /** Original error if available */
  originalError?: unknown;
}

/**
 * Successful send response
 */
export interface SendSuccess {
  /** Email ID from provider */
  id: string;
  /** Provider name */
  provider: string;
  /** Timestamp of send */
  sentAt: Date;
}

/**
 * Single email send result
 */
export type SendResult = Result<SendSuccess, EmailError>;

// ============================================
// Result Factory Functions
// ============================================

/**
 * Create a failure result with the given error
 */
export const fail = <E>(error: E): { success: false; error: E } => ({
  success: false,
  error,
});

/**
 * Create an EmailError object
 */
export const emailError = (
  code: EmailErrorCode,
  message: string,
  options?: {
    provider?: string;
    originalError?: unknown;
  },
): EmailError => ({
  code,
  message,
  ...options,
});

/**
 * Create a failure result with an EmailError
 */
export const emailFail = (
  code: EmailErrorCode,
  message: string,
  options?: {
    provider?: string;
    originalError?: unknown;
  },
): { success: false; error: EmailError } => fail(emailError(code, message, options));
