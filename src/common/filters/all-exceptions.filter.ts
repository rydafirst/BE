import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Global filter: never leaks stack traces / SQL / internal ids to clients.
 * Money paths fail closed elsewhere; this only shapes the safe HTTP response.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = (req.headers['x-correlation-id'] as string) ?? 'n/a';

    // Domain errors (e.g. IllegalTransitionError) opt in to a specific HTTP status + a safe,
    // client-facing message via markers, so an illegal state change is a 409 — not a 500 — without
    // the domain layer depending on Nest. Duck-typed to avoid coupling the filter to any module.
    const domain = asDomainError(exception);

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : domain
        ? domain.httpStatus
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // For HttpExceptions, prefer the structured `message` from getResponse() (e.g. the array of
    // validation errors) over the generic class message like "Bad Request Exception", so clients
    // see which field failed. Non-HttpExceptions never leak internals — they stay generic.
    let safeMessage: string | string[] = 'Internal server error';
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {
        safeMessage = response;
      } else if (response && typeof response === 'object' && 'message' in response) {
        safeMessage = (response as { message: string | string[] }).message;
      } else {
        safeMessage = exception.message;
      }
    } else if (domain) {
      safeMessage = domain.clientMessage;
    }

    // Full detail goes to logs (PII-safe), never to the client.
    this.logger.error(
      `[${correlationId}] ${req.method} ${req.url} -> ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(status).json({ statusCode: status, message: safeMessage, correlationId });
  }
}

/** A domain error that has explicitly opted in to being surfaced to the client with a status. */
interface ExposedDomainError { httpStatus: number; expose: true; clientMessage: string }

function asDomainError(e: unknown): ExposedDomainError | null {
  if (
    e && typeof e === 'object' &&
    (e as { expose?: unknown }).expose === true &&
    typeof (e as { httpStatus?: unknown }).httpStatus === 'number' &&
    typeof (e as { clientMessage?: unknown }).clientMessage === 'string'
  ) {
    return e as ExposedDomainError;
  }
  return null;
}
