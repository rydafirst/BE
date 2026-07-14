import { Inject, Injectable } from '@nestjs/common';
import type { CustomerEmailSource } from '../../jobs/customer-email.port.js';
import { USER_REPO, type UserRepository } from '../ports.js';

/** Customer email source backed by the user record captured at OTP login. */
@Injectable()
export class UserCustomerEmail implements CustomerEmailSource {
  constructor(@Inject(USER_REPO) private readonly users: UserRepository) {}
  getEmail(userId: string): Promise<string | null> {
    return this.users.getEmail(userId);
  }
}
