/**
 * HTTP end-to-end scaffolding (runs once dev/test deps + a running app are available).
 * Boots the Nest app with the in-memory adapters and drives the delivery journey over HTTP.
 * NOTE: requires `@nestjs/testing`, `supertest`, and `ts-jest` (added to devDependencies).
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Rydafirst API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('liveness is public and healthy', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });

  it('rejects an unauthenticated job creation', async () => {
    await request(app.getHttpServer()).post('/v1/jobs').send({}).expect(401);
  });

  // TODO(persistence): full happy path — OTP verify -> quote -> create -> fund webhook ->
  // accept -> arrive -> issue-code -> confirm-code -> assert RELEASED and ledger balanced.
});
