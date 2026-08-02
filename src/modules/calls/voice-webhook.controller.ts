import { Body, Controller, Header, HttpCode, Param, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { CallSessionService } from './call-session.service.js';
import { buildEmptyXml, buildRejectXml } from './domain/call-session.js';

/**
 * Africa's Talking voice callback. AT POSTs (form-encoded) here when a placed call is answered or
 * ends, and expects XML back describing what to do. Public (no JWT — the caller is AT, not a user),
 * authenticated instead by an unguessable secret path segment plus the session lookup.
 */
@Public()
@Controller({ version: '1' })
export class VoiceWebhookController {
  constructor(private readonly calls: CallSessionService) {}

  @Post('webhooks/voice/africastalking/:secret')
  @HttpCode(200)
  @Header('Content-Type', 'application/xml')
  async africastalking(
    @Param('secret') secret: string,
    @Body() body: Record<string, string> | undefined,
  ): Promise<string> {
    if (!secret || secret !== this.calls.callbackSecret()) {
      return buildRejectXml('Unauthorized.');
    }
    const sessionId = String(body?.sessionId ?? '');
    if (!sessionId) return buildEmptyXml();

    if (String(body?.isActive ?? '') === '1') {
      // Ongoing call — the initiator answered; bridge them to the counterparty.
      return this.calls.handleAnswer(sessionId);
    }
    // Final callback — record duration and cost, then acknowledge.
    const durationSec = Number(body?.durationInSeconds ?? 0) || 0;
    const amount = body?.amount ? String(body.amount) : undefined;
    const currency = body?.currencyCode ? String(body.currencyCode) : undefined;
    const cost = amount ? { amount, currency: currency ?? '' } : undefined;
    return this.calls.handleFinal(sessionId, durationSec, cost);
  }
}
