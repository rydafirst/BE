import {
  ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { JobsService } from '../jobs/jobs.service.js';
import { TrackingService } from './tracking.service.js';

/**
 * Real-time tracking. Rooms are per-job; only the job's participants may join.
 * NOTE(prod): authenticate the socket via a JWT in the handshake and derive userId from it.
 * Here userId is taken from the payload and authorized against the job (participant check).
 */
@WebSocketGateway({ cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',') } })
export class TrackingGateway {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jobs: JobsService,
    private readonly tracking: TrackingService,
  ) {}

  /** Customer or rider subscribes to a job's live channel. */
  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { jobId: string; userId: string },
  ): Promise<{ ok: boolean }> {
    await this.jobs.getJob(body.userId, body.jobId); // throws if not a participant
    await client.join(this.room(body.jobId));
    const last = await this.tracking.getLastKnown(body.jobId);
    if (last) client.emit('location', { jobId: body.jobId, ...last });
    return { ok: true };
  }

  /** Assigned rider publishes location; throttled, then broadcast to the room. */
  @SubscribeMessage('location')
  async location(
    @MessageBody() body: { jobId: string; riderId: string; lat: number; lng: number },
  ): Promise<void> {
    const job = await this.jobs.getJob(body.riderId, body.jobId);
    if (job.riderId !== body.riderId) return; // only the assigned rider may publish
    const { emitted } = await this.tracking.record(body.jobId, { lat: body.lat, lng: body.lng });
    if (emitted) {
      this.server.to(this.room(body.jobId)).emit('location', {
        jobId: body.jobId, point: { lat: body.lat, lng: body.lng }, at: Date.now(),
      });
    }
  }

  private room(jobId: string): string { return `job:${jobId}`; }
}
