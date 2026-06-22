import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "@upstash/redis";

/**
 * Upstash Redis (REST) client. Redis is a CACHE and ephemeral coordination
 * layer ONLY — never a source of truth for money or deadlines (those live in
 * Postgres; see BUILD_PLAN.md §2.4). Used later for OTP rate-limits, realtime
 * fan-out, and short-lived locks.
 */
@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      this.logger.warn(
        "UPSTASH_REDIS_REST_URL / _TOKEN not set — Redis is unconfigured",
      );
    }
    this.client = new Redis({ url: url ?? "", token: token ?? "" });
  }

  /** Round-trips to Redis; returns true if reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }
}
