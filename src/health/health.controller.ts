import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator.js';

@Public()
@Controller('health')
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
