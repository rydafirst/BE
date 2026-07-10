import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'is_public';
/** Marks a route/controller as not requiring authentication (auth, health, webhooks). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
