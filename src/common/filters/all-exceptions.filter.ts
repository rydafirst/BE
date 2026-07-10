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
    const safeMessage =
      exception instanceof HttpException ? exception.message : 'Internal server error';

    // Full detail goes to logs (PII-safe), never to the client.
    this.logger.error(
      `[${correlationId}] ${req.method} ${req.url} -> ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(status).json({ statusCode: status, message: safeMessage, correlationId });
  }
}
