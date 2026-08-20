import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../errors/domain.exception';
import { ErrorCode } from '../errors/error-codes';

interface ErrorBody { code: string; message: string; requestId: string; details?: unknown }

/**
 * Converts every thrown value into one predictable JSON shape.
 *
 * Deliberate errors keep their code and message so the client can react
 * precisely. Unexpected errors return a generic message plus a request id, with
 * the real detail going only to the server log — a stack trace in an HTTP
 * response tells an attacker the schema, the ORM and the file layout, while the
 * request id still lets support find the exact log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = randomUUID();

    const { status, body } = this.describe(exception, requestId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} [${requestId}] ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${body.code}`);
    }

    response.status(status).json({ error: body });
  }

  private describe(exception: unknown, requestId: string): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.getStatus(),
        body: { code: exception.code, message: exception.message, requestId, details: exception.details },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const raw = record.message;
        const message = Array.isArray(raw) ? raw.join('; ')
          : typeof raw === 'string' ? raw : exception.message;

        return {
          status,
          body: {
            code: typeof record.code === 'string' ? record.code
              : status === HttpStatus.BAD_REQUEST ? ErrorCode.VALIDATION_ERROR : ErrorCode.BAD_REQUEST,
            message,
            requestId,
            details: Array.isArray(raw) ? raw : undefined,
          },
        };
      }
      return { status, body: { code: ErrorCode.BAD_REQUEST, message: exception.message, requestId } };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 is a unique-constraint violation: a duplicate, which is the
      // caller's problem to fix rather than a server fault.
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: { code: ErrorCode.CONFLICT, message: 'A record with these details already exists.', requestId },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: ErrorCode.NOT_FOUND, message: 'The requested record was not found.', requestId },
        };
      }
      if (exception.code === 'P2003') {
        return {
          status: HttpStatus.BAD_REQUEST,
          body: { code: ErrorCode.BAD_REQUEST, message: 'A referenced record does not exist.', requestId },
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred. Please quote the reference when reporting this.',
        requestId,
      },
    };
  }
}
