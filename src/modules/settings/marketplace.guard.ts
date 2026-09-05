import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { SettingsService } from './settings.service.js';

/**
 * Server-enforced marketplace master switch. Applied to every vendor/marketplace-facing route; when the
 * marketplace is OFF (the default until the fund-flow has legal sign-off) it refuses the request with a
 * clear message — so turning the feature off in admin genuinely disables it, not just hides the UI.
 * Fail-closed: SettingsService.marketplaceEnabled() itself falls back to the env default if the store
 * errors, so a broken store can never silently switch the marketplace on.
 */
@Injectable()
export class MarketplaceGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}
  async canActivate(): Promise<boolean> {
    if (await this.settings.marketplaceEnabled()) return true;
    throw new ForbiddenException('The marketplace is currently unavailable.');
  }
}
