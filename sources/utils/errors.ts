/**
 * Error utilities for safe error handling and standardized error management.
 *
 * This module provides:
 * - AppError: Custom error class with error codes, retry support, and cause chain
 * - ErrorCodes: Standardized error code constants for the application
 *
 * @module utils/errors
 */

/**
 * Standardized error codes for the happy-app application.
 * These codes provide programmatic error identification and consistent categorization.
 */
export const ErrorCodes = {
    // Auth errors
    AUTH_FAILED: 'AUTH_FAILED',
    INVALID_KEY: 'INVALID_KEY',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED', // 401 from server - triggers logout, never retried

    // Socket/RPC errors
    SOCKET_NOT_CONNECTED: 'SOCKET_NOT_CONNECTED',
    RPC_CANCELLED: 'RPC_CANCELLED',
    RPC_FAILED: 'RPC_FAILED',
    SYNC_FAILED: 'SYNC_FAILED',

    // API errors
    API_ERROR: 'API_ERROR',
    FETCH_FAILED: 'FETCH_FAILED',
    FETCH_ABORTED: 'FETCH_ABORTED',
    TIMEOUT: 'TIMEOUT',

    // Encryption errors
    ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
    DECRYPTION_FAILED: 'DECRYPTION_FAILED',

    // Resource errors
    NOT_FOUND: 'NOT_FOUND',
    VERSION_CONFLICT: 'VERSION_CONFLICT',
    ALREADY_EXISTS: 'ALREADY_EXISTS',

    // Validation errors
    INVALID_INPUT: 'INVALID_INPUT',
    VALIDATION_FAILED: 'VALIDATION_FAILED',

    // Configuration errors
    NOT_CONFIGURED: 'NOT_CONFIGURED',

    // Subscription/Purchase errors
    PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',

    // Service errors
    SERVICE_ERROR: 'SERVICE_ERROR',
    SERVICE_NOT_CONNECTED: 'SERVICE_NOT_CONNECTED',

    // Internal errors
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/**
 * Type representing valid error codes from the ErrorCodes constant.
 */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Structured JSON representation of an AppError.
 * Used for serialization, logging, and API responses.
 */
export interface AppErrorJSON {
    code: ErrorCode;
    message: string;
    name: string;
    canTryAgain: boolean;
    cause?: string;
    stack?: string;
}

/**
 * Application-specific error class with standardized error codes and retry support.
 *
 * AppError provides:
 * - Consistent error identification via error codes
 * - Retry capability indication for UI handling (integrates with useHappyAction)
 * - Error cause chain preservation (ES2022 compatible)
 * - Structured JSON serialization for logging
 * - Proper prototype chain for instanceof checks
 *
 * @example Basic usage
 * ```typescript
 * throw new AppError(ErrorCodes.AUTH_FAILED, 'Session expired');
 * ```
 *
 * @example With retry capability
 * ```typescript
 * throw new AppError(ErrorCodes.FETCH_FAILED, 'Network error', { canTryAgain: true });
 * ```
 *
 * @example With cause chain
 * ```typescript
 * try {
 *   await fetch(url);
 * } catch (error) {
 *   throw new AppError(
 *     ErrorCodes.API_ERROR,
 *     'Failed to fetch data',
 *     { canTryAgain: true, cause: error instanceof Error ? error : undefined }
 *   );
 * }
 * ```
 */
export class AppError extends Error {
    /** Error code for programmatic identification */
    public readonly code: ErrorCode;

    /** Whether the user can retry the operation */
    public readonly canTryAgain: boolean;

    /**
     * Original error that caused this error, if any.
     * Uses Error.cause pattern from ES2022.
     */
    public readonly cause?: Error;

    /**
     * Creates a new AppError instance.
     *
     * @param code - Error code from ErrorCodes constant
     * @param message - Human-readable error message
     * @param options - Optional configuration
     * @param options.canTryAgain - Whether the operation can be retried (default: false)
     * @param options.cause - Optional original error that caused this error
     */
    constructor(
        code: ErrorCode,
        message: string,
        options?: { canTryAgain?: boolean; cause?: Error }
    ) {
        super(message);
        this.code = code;
        this.canTryAgain = options?.canTryAgain ?? false;
        this.cause = options?.cause;
        this.name = 'AppError';

        // Fix prototype chain for ES5 compatibility with extending built-ins
        Object.setPrototypeOf(this, AppError.prototype);
    }

    /**
     * Converts the error to a structured JSON object.
     * Called automatically by JSON.stringify().
     */
    toJSON(): AppErrorJSON {
        const json: AppErrorJSON = {
            code: this.code,
            message: this.message,
            name: this.name,
            canTryAgain: this.canTryAgain,
        };

        if (this.cause?.message) {
            json.cause = this.cause.message;
        }
        if (this.stack) {
            json.stack = this.stack;
        }

        return json;
    }

    /**
     * Creates an AppError from an unknown error value.
     *
     * @param code - Error code to assign
     * @param message - Error message
     * @param error - Unknown error value to wrap
     * @param canTryAgain - Whether the operation can be retried (default: false)
     * @returns AppError instance with cause chain if error was an Error
     */
    static fromUnknown(
        code: ErrorCode,
        message: string,
        error: unknown,
        canTryAgain: boolean = false
    ): AppError {
        const cause = error instanceof Error ? error : undefined;
        return new AppError(code, message, { canTryAgain, cause });
    }

    /**
     * Type guard to check if an error is an AppError.
     */
    static isAppError(error: unknown): error is AppError {
        return error instanceof AppError;
    }
}

/**
 * HappyError is an alias for AppError for backward compatibility.
 * New code should use AppError directly.
 *
 * @deprecated Use AppError instead
 */
export class HappyError extends AppError {
    constructor(message: string, canTryAgain: boolean) {
        super(ErrorCodes.INTERNAL_ERROR, message, { canTryAgain });
        this.name = 'HappyError';
        Object.setPrototypeOf(this, HappyError.prototype);
    }
}
