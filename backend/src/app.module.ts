import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health/health.controller";
import { PrismaService } from "./prisma/prisma.service";
import { RedisService } from "./redis/redis.service";

/**
 * Root module. As the build plan progresses, domain modules (auth, circles,
 * bets, wallet, verification, …) are registered here. Each maps to a product
 * object per spec §14 ("modular architecture maps to domain objects").
 */
@Module({
  imports: [
    // Loads backend/.env into process.env (cwd is backend/ when running `dev`).
    ConfigModule.forRoot({ isGlobal: true }),
  ],
  controllers: [HealthController],
  providers: [PrismaService, RedisService],
})
export class AppModule {}
