import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./auth/auth.module";
import { CirclesModule } from "./circles/circles.module";
import { MoneyModule } from "./money/money.module";
import { SearchModule } from "./search/search.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";

/**
 * Root module. As the build plan progresses, domain modules (auth, circles,
 * bets, verification, …) are registered here. Each maps to a product object
 * per spec §14 ("modular architecture maps to domain objects").
 */
@Module({
  imports: [
    // Loads backend/.env into process.env (cwd is backend/ when running `dev`).
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    MoneyModule,
    AuthModule,
    CirclesModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
