import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

type HealthResponse = {
  status: "ok" | "degraded";
  service: string;
  db: boolean;
  redis: boolean;
  timestamp: string;
};

/**
 * Liveness + dependency probe. Also what the Expo app pings to confirm
 * connectivity. Verifies Postgres and Redis are actually reachable rather than
 * just reporting that the process is up.
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([
      this.checkDb(),
      this.redis.isHealthy(),
    ]);
    return {
      status: db && redis ? "ok" : "degraded",
      service: "wager-api",
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
