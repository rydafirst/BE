import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator.js';

// Version-neutral so health checks live at /health/live (not /v1/health/live) — this is the
// path Railway/uptime probes hit.
@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(): { status: 'ok'; ts: string } {
    // Extend with DB/Redis pings as those modules land.
    return { status: 'ok', ts: new Date().toISOString() };
  }
}
