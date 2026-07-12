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

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

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
    }

    // Full detail goes to logs (PII-safe), never to the client.
    this.logger.error(
      `[${correlationId}] ${req.method} ${req.url} -> ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(status).json({ statusCode: status, message: safeMessage, correlationId });
  }
}
