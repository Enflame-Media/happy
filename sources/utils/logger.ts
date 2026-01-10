/**
 * Production-safe logger utility with automatic sensitive data redaction
 *
 * This logger ensures that debug/info logs are stripped from production builds
 * while keeping error and warning logs for debugging production issues.
 * Additionally, all logged data is automatically redacted to prevent sensitive
 * information from appearing in logs, crash reports, or console output.
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   logger.debug('[Component] Debug info', data);
 *   logger.info('[Feature] Informational message');
 *   logger.warn('[Feature] Warning condition');
 *   logger.error('[Feature] Error occurred', error);
 *
 * Security:
 * - All logged data is automatically redacted for sensitive patterns
 * - Tokens, secrets, credentials, and long alphanumeric strings are replaced with [REDACTED]
 * - Object keys matching sensitive patterns have their values redacted
 *
 * @module utils/logger
 * @see {@link https://owasp.org/www-project-cheat-sheets/cheatsheets/Logging_Cheat_Sheet.html}
 */

/* oxlint-disable no-console */
/* eslint-disable no-console */

/**
 * Patterns for sensitive object keys that should have values redacted.
 * These patterns match common credential/token field names.
 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /key/i,
  /credential/i,
  /auth/i,
  /bearer/i,
  /api[-_]?key/i,
  /private/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
] as const;

/**
 * Patterns for sensitive string content.
 * These patterns match token-like strings and should be redacted.
 */
const SENSITIVE_STRING_PATTERNS = [
  /Bearer [a-zA-Z0-9._-]+/gi, // Bearer tokens
  /[a-zA-Z0-9._-]{40,}/g, // Long alphanumeric strings (likely tokens)
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, // JWT tokens
] as const;

/**
 * Redacts sensitive data from a string.
 * Replaces patterns that look like tokens or credentials with [REDACTED].
 */
function redactString(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_STRING_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Checks if a key name matches sensitive patterns.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively redacts sensitive data from an object.
 * - Keys matching sensitive patterns have their values replaced with [REDACTED]
 * - String values are checked for sensitive patterns
 * - Nested objects and arrays are processed recursively
 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => redactValue(item));
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Redacts sensitive data from any value type.
 */
function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    // Handle Error objects specially - preserve the error but redact message
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message),
        stack: value.stack ? redactString(value.stack) : undefined,
      };
    }
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Redacts all arguments passed to a logger function.
 * Exported for use by remoteLogger.ts to redact remote logging payloads.
 */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg) => redactValue(arg));
}

/**
 * Logger interface for type safety and documentation
 */
interface Logger {
  /** Development-only debug logging - stripped in production. All data is redacted. */
  debug: (...args: unknown[]) => void;
  /** Development-only info logging - stripped in production. All data is redacted. */
  info: (...args: unknown[]) => void;
  /** Warning logging - visible in production. All data is redacted. */
  warn: (...args: unknown[]) => void;
  /** Error logging - visible in production. All data is redacted. */
  error: (...args: unknown[]) => void;
}

/**
 * No-op function for production
 */
const noop = () => {};

/**
 * Production-safe logger with automatic sensitive data redaction
 *
 * - debug/info: Only logged in development (__DEV__ = true)
 * - warn/error: Always logged (needed for production debugging)
 * - All logged data is automatically redacted to prevent credential leaks
 *
 * The __DEV__ check allows bundlers to tree-shake debug logs in production.
 */
export const logger: Logger = {
  debug: __DEV__
    ? (...args: unknown[]) => console.log('[DEBUG]', ...redactArgs(args))
    : noop,

  info: __DEV__
    ? (...args: unknown[]) => console.log('[INFO]', ...redactArgs(args))
    : noop,

  warn: (...args: unknown[]) => console.warn('[WARN]', ...redactArgs(args)),

  error: (...args: unknown[]) => {
    console.error('[ERROR]', ...redactArgs(args));
    // Future: Integrate with error tracking service (Sentry, etc.)
  },
};

/**
 * Type guard to check if logging is enabled
 * Use for expensive log preparation:
 *
 * @example
 * if (isDevMode()) {
 *   const expensiveData = JSON.stringify(largeObject);
 *   logger.debug('Data:', expensiveData);
 * }
 */
export const isDevMode = (): boolean => __DEV__;

/**
 * Utility function to redact a string for external use.
 * Useful for sanitizing data before storing in in-memory logs.
 *
 * @example
 * const sanitized = redact('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
 * // Returns: 'Bearer [REDACTED]'
 */
export function redact(value: string): string {
  return redactString(value);
}
