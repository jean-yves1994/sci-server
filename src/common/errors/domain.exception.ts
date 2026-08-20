import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodeValue } from './error-codes';

/**
 * Base for every deliberately raised error. Carrying the code alongside the
 * status means the filter never guesses, and clients never parse prose.
 */
export class DomainError extends HttpException {
  constructor(
    public readonly code: ErrorCodeValue,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class BadRequestError extends DomainError {
  constructor(code: ErrorCodeValue, message: string, details?: unknown) {
    super(code, message, HttpStatus.BAD_REQUEST, details);
  }
}
export class UnauthorizedError extends DomainError {
  constructor(code: ErrorCodeValue, message: string) {
    super(code, message, HttpStatus.UNAUTHORIZED);
  }
}
export class ForbiddenError extends DomainError {
  constructor(message: string, code: ErrorCodeValue) {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}
export class NotFoundError extends DomainError {
  constructor(code: ErrorCodeValue, message: string) {
    super(code, message, HttpStatus.NOT_FOUND);
  }
}
export class ConflictError extends DomainError {
  constructor(code: ErrorCodeValue, message: string, details?: unknown) {
    super(code, message, HttpStatus.CONFLICT, details);
  }
}
