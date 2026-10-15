import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

/**
 * Socket.IO adapter backed by Redis pub/sub, so real-time events (live tracking) broadcast to the
 * right room across EVERY backend instance — not just the one a client happens to be connected to.
 *
 * Without this, running more than one API instance silently breaks tracking: a rider on instance A and
 * the customer on instance B never see each other's room. With it, all instances share one logical bus.
 *
 * Used only when a Redis URL is configured (production); in dev/memory mode the default in-process
 * adapter is used, which behaves identically on a single instance.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger('RedisIoAdapter');
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pub?: Redis;
  private sub?: Redis;

  constructor(app: INestApplicationContext, private readonly redisUrl: string) {
    super(app);
  }

  /** Open the pub/sub client pair and build the adapter. Call once before createIOServer. */
  async connectToRedis(): Promise<void> {
    this.pub = new Redis(this.redisUrl, { maxRetriesPerRequest: 3 });
    this.sub = this.pub.duplicate();
    this.adapterConstructor = createAdapter(this.pub, this.sub);
    this.log.log('Socket.IO Redis adapter active — tracking broadcasts span all instances');
  }

  /** Close the Socket.IO server AND the Redis clients on shutdown (best-effort). */
  override async close(server: Server): Promise<void> {
    await Promise.allSettled([
      Promise.resolve(super.close(server)),
      this.pub?.quit(),
      this.sub?.quit(),
    ]);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
