import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { SettingsService } from './settings.service.js';

/**
 * Public, unauthenticated feature flags the client apps read to decide which entry points to show
 * (e.g. hide the marketplace when it is switched off). This is a UI convenience only — every
 * marketplace endpoint is still enforced server-side by MarketplaceGuard, so hiding the buttons is
 * never the thing standing between a disabled feature and a request.
 */
@Controller({ path: 'config', version: '1' })
export class PublicConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  async config(): Promise<{ marketplaceEnabled: boolean }> {
    return { marketplaceEnabled: await this.settings.marketplaceEnabled() };
  }
}
