import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { OtpRecord } from '../domain/otp.js';
import type { RefreshTokenState } from '../domain/refresh-rotation.js';
import type { Role } from '../../../common/auth/roles.js';
import type { OtpRepository, RefreshTokenRepository, UserRepository } from '../ports.js';

@Injectable()
export class PrismaOtpRepo implements OtpRepository {
  constructor(private readonly db: PrismaService) {}
  async save(phone: string, r: OtpRecord): Promise<void> {
    await this.db.otp.upsert({
      where: { phone },
      update: { codeHash: r.codeHash, attempts: r.attempts, consumed: r.consumed, createdAt: new Date(r.createdAtMs) },
      create: { phone, codeHash: r.codeHash, attempts: r.attempts, consumed: r.consumed, createdAt: new Date(r.createdAtMs) },
    });
  }
  async find(phone: string): Promise<OtpRecord | null> {
    const o = await this.db.otp.findUnique({ where: { phone } });
    return o ? { codeHash: o.codeHash, createdAtMs: o.createdAt.getTime(), attempts: o.attempts, consumed: o.consumed } : null;
  }
  async incrementAttempts(phone: string): Promise<void> {
    await this.db.otp.update({ where: { phone }, data: { attempts: { increment: 1 } } });
  }
  async markConsumed(phone: string): Promise<void> {
    await this.db.otp.update({ where: { phone }, data: { consumed: true } });
  }
}

@Injectable()
export class PrismaRefreshRepo implements RefreshTokenRepository {
  constructor(private readonly db: PrismaService) {}
  async findByHash(tokenHash: string): Promise<RefreshTokenState | null> {
    const r = await this.db.refreshToken.findUnique({ where: { tokenHash } });
    return r ? { familyId: r.familyId, tokenHash: r.tokenHash, rotated: r.rotated, revoked: r.revoked } : null;
  }
  async createFamily(userId: string, tokenHash: string): Promise<void> {
    await this.db.refreshToken.create({ data: { tokenHash, familyId: crypto.randomUUID(), userId } });
  }
  async rotate(oldHash: string, newHash: string): Promise<void> {
    const old = await this.db.refreshToken.findUnique({ where: { tokenHash: oldHash } });
    if (!old) return;
    await this.db.$transaction([
      this.db.refreshToken.update({ where: { tokenHash: oldHash }, data: { rotated: true } }),
      this.db.refreshToken.create({ data: { tokenHash: newHash, familyId: old.familyId, userId: old.userId } }),
    ]);
  }
  async revokeFamily(familyId: string): Promise<void> {
    await this.db.refreshToken.updateMany({ where: { familyId }, data: { revoked: true } });
  }
}

@Injectable()
export class PrismaUserRepo implements UserRepository {
  constructor(private readonly db: PrismaService) {}
  async upsertByPhone(phone: string, role: Role): Promise<{ id: string; role: Role }> {
    const existing = await this.db.user.findUnique({ where: { phone } });
    if (!existing) {
      const created = await this.db.user.create({ data: { phone, role } });
      return { id: created.id, role: created.role as Role };
    }
    // Follow the role the user is signing in as (a phone can be a customer today, a rider tomorrow),
    // but never downgrade an admin through OTP login.
    const nextRole: Role = existing.role === 'ADMIN' ? (existing.role as Role) : role;
    if (existing.role === nextRole) return { id: existing.id, role: existing.role as Role };
    const updated = await this.db.user.update({ where: { phone }, data: { role: nextRole } });
    return { id: updated.id, role: updated.role as Role };
  }
}
