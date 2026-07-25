import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.validation.js';
import { buildDatasourceUrl } from './datasource-url.js';

/**
 * Nest-managed Prisma client. When a DATABASE_URL is configured (Postgres mode) it connects through a
 * pool-tuned URL — bounding concurrent connections and how long a query waits for a free one — so a
 * shared-host DB blip fails fast and cleanly rather than hanging. In memory mode (no DATABASE_URL) it
 * falls back to the default client, unchanged.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super(
      env.DATABASE_URL
        ? {
            datasources: {
              db: {
                url: buildDatasourceUrl(env.DATABASE_URL, {
                  connectionLimit: env.DB_CONNECTION_LIMIT,
                  poolTimeoutSeconds: env.DB_POOL_TIMEOUT,
                }),
              },
            },
          }
        : undefined,
    );
  }

  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
