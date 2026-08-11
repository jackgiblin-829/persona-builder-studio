/**
 * Typed application errors. Anything shown to a browser goes through
 * `toPublicError`, which strips detail from unexpected errors so internal
 * state, SQL and vendor payloads never leak into the UI.
 */

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "immutable"
  | "rate_limited"
  | "vendor_error"
  | "vendor_rate_limited"
  | "vendor_credit_exhausted"
  | "vendor_timeout"
  | "vendor_unavailable"
  | "vendor_not_configured"
  | "schema_validation"
  | "internal";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: {
      status?: number;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = opts.status ?? defaultStatus(code);
    this.retryable = opts.retryable ?? defaultRetryable(code);
    this.details = opts.details;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "validation":
    case "schema_validation":
      return 400;
    case "conflict":
    case "immutable":
      return 409;
    case "rate_limited":
    case "vendor_rate_limited":
      return 429;
    case "vendor_timeout":
    case "vendor_unavailable":
      return 504;
    default:
      return 500;
  }
}

function defaultRetryable(code: ErrorCode): boolean {
  return (
    code === "vendor_rate_limited" ||
    code === "vendor_timeout" ||
    code === "vendor_unavailable" ||
    code === "rate_limited"
  );
}

export class UnauthenticatedError extends AppError {
  constructor(message = "You must sign in to continue.") {
    super("unauthenticated", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource.") {
    super("forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Resource") {
    super("not_found", `${what} was not found.`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("validation", message, { details });
  }
}

export class ImmutableError extends AppError {
  constructor(what: string) {
    super("immutable", `${what} is approved and cannot be modified. Create a new version instead.`);
  }
}

/** A vendor call failed. Never caught and replaced with mock data — see ADR-009. */
export class VendorError extends AppError {
  readonly vendor: string;
  readonly operation: string;
  readonly httpStatus?: number;

  constructor(
    vendor: string,
    operation: string,
    message: string,
    opts: {
      code?: Extract<ErrorCode, `vendor_${string}`>;
      httpStatus?: number;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(opts.code ?? "vendor_error", message, {
      retryable: opts.retryable,
      details: opts.details,
      cause: opts.cause,
    });
    this.vendor = vendor;
    this.operation = operation;
    this.httpStatus = opts.httpStatus;
  }
}

export class VendorNotConfiguredError extends VendorError {
  constructor(vendor: string, operation: string) {
    super(
      vendor,
      operation,
      `${vendor} is set to live mode but its credentials are not configured.`,
      {
        code: "vendor_not_configured",
        retryable: false,
      },
    );
  }
}

export type PublicError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

const GENERIC_MESSAGE = "Something went wrong. The details have been logged.";

/** Redact anything that is not a deliberate, user-facing AppError. */
export function toPublicError(error: unknown): PublicError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return { code: "internal", message: GENERIC_MESSAGE, retryable: false };
}

export function isRetryable(error: unknown): boolean {
  return error instanceof AppError ? error.retryable : false;
}
