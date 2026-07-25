import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller.js';
import { GEO_PROVIDER, ROUTE_PROVIDER } from './ports.js';
import { GoogleGeoProvider } from './adapters/google-geo.provider.js';
import { OsrmRouteProvider } from './adapters/osrm-route.provider.js';

// ConfigModule is @Global, so ENV is injectable in the adapters without an explicit import.
// Swap providers by binding a different adapter to GEO_PROVIDER / ROUTE_PROVIDER — no controller changes.
@Module({
  controllers: [GeoController],
  providers: [
    { provide: GEO_PROVIDER, useClass: GoogleGeoProvider },
    { provide: ROUTE_PROVIDER, useClass: OsrmRouteProvider },
  ],
})
export class GeoModule {}
