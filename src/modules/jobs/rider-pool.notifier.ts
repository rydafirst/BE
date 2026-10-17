import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/** A job entering (add) or leaving (remove) the rider discovery pool (SEARCHING). */
export interface PoolEvent { kind: 'add' | 'remove'; jobId: string }

/**
 * A tiny in-process event bus that announces when a job enters or leaves the rider job pool, so the
 * tracking gateway can push the change to online riders in real time (instead of them waiting for the
 * next poll). Decoupled on purpose: JobsService publishes, the WebSocket gateway subscribes — neither
 * imports the other. Cross-instance fan-out is handled by the Socket.IO Redis adapter at emit time, so
 * this only needs to reach the gateway on the SAME instance that made the change.
 */
@Injectable()
export class RiderPoolNotifier {
  private readonly ee = new EventEmitter();

  onChange(listener: (e: PoolEvent) => void): void {
    this.ee.setMaxListeners(0);
    this.ee.on('change', listener);
  }
  added(jobId: string): void { this.ee.emit('change', { kind: 'add', jobId }); }
  removed(jobId: string): void { this.ee.emit('change', { kind: 'remove', jobId }); }
}
