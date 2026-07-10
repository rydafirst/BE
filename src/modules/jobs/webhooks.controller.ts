import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { EscrowService } from '../payments/escrow.service.js';
import { JobsService } from './jobs.service.js';

interface FlwWebhook { event?: string; data?: { id?: string | number; status?: string; tx_ref?: string } }

@Public()
@Controller({ version: '1' })
export class WebhooksController {
  constructor(
    private readonly escrow: EscrowService,
    private readonly jobs: JobsService,
  ) {}

  /** Flutterwave charge webhook: verify signature -> verify txn -> fund the job. */
  @Post('webhooks/flutterwave')
  @HttpCode(200)
  async flutterwave(
    @Headers('verif-hash') signature: string,
    @Body() body: FlwWebhook,
  ): Promise<{ status: string }> {
    if (body?.event !== 'charge.completed') return { status: 'ignored' };
    const transactionId = String(body.data?.id ?? '');
    if (!transactionId) return { status: 'ignored' };

    const res = await this.escrow.processChargeWebhook(signature ?? '', transactionId);
    if (res.status === 'duplicate') return { status: 'duplicate' };
    if (res.verified.status !== 'successful') return { status: 'not_successful' };

    await this.jobs.confirmFundedByTxRef(res.verified);
    return { status: 'ok' };
  }
}
