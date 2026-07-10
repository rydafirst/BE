import { Global, Module } from '@nestjs/common';
import { validateEnv, type Env } from './env.validation.js';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
