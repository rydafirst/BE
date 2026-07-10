import 'dotenv/config'; // load .env into process.env before anything reads it
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { validateEnv } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Security headers.
  app.use(helmet());

  // CORS: strict allow-list only (no wildcards).
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });

  // URI versioning: /v1/...
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Reject unknown/invalid input at the boundary.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`Rydafirst API listening on :${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
