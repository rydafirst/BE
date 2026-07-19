import { Controller, Get, Inject, Query } from '@nestjs/common';
import { GEO_PROVIDER, type GeoProvider } from './ports.js';

/**
 * Authenticated proxy for address search. Any signed-in user (customer or rider) may call these;
 * requiring auth keeps the server-side Maps key from being driven by anonymous traffic. The provider
 * key never leaves the server — the app only ever talks to these endpoints. Depends on the
 * {@link GeoProvider} port, not a concrete vendor.
 */
@Controller({ version: '1' })
export class GeoController {
  constructor(@Inject(GEO_PROVIDER) private readonly geo: GeoProvider) {}

  @Get('places/autocomplete')
  autocomplete(@Query('input') input = '', @Query('sessiontoken') sessionToken = '') {
    return this.geo.autocomplete(input.slice(0, 200), sessionToken.slice(0, 100));
  }

  @Get('places/details')
  details(@Query('placeId') placeId = '', @Query('sessiontoken') sessionToken = '') {
    return this.geo.details(placeId.slice(0, 300), sessionToken.slice(0, 100));
  }

  @Get('geo/reverse')
  reverse(@Query('lat') lat = '', @Query('lng') lng = '') {
    return this.geo.reverseGeocode(Number(lat), Number(lng));
  }
}
