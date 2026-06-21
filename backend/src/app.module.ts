import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";

/**
 * Root module. As the build plan progresses, domain modules (auth, circles,
 * bets, wallet, verification, …) are registered here. Each maps to a product
 * object per spec §14 ("modular architecture maps to domain objects").
 */
@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
