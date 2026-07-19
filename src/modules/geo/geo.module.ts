import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller.js';
import { GEO_PROVIDER } from './ports.js';
import { GoogleGeoProvider } from './adapters/google-geo.provider.js';

// ConfigModule is @Global, so ENV is injectable in the adapter without an explicit import.
// Swap providers by binding a different adapter to GEO_PROVIDER — no controller changes.
@Module({
  controllers: [GeoController],
  providers: [{ provide: GEO_PROVIDER, useClass: GoogleGeoProvider }],
})
export class GeoModule {}
