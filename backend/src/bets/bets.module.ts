import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MoneyModule } from "../money/money.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { BetsService } from "./bets.service";
import { BetsController } from "./bets.controller";
import { LineService } from "./line.service";
import { StakingService } from "./staking.service";
import { VerificationService } from "./verification.service";
import { ResolutionService } from "./resolution.service";
import { DisputeService } from "./dispute.service";
import { CancellationService } from "./cancellation.service";

@Module({
  imports: [PrismaModule, MoneyModule, SchedulerModule],
  providers: [BetsService, LineService, StakingService, VerificationService, ResolutionService, DisputeService, CancellationService],
  controllers: [BetsController],
  exports: [BetsService],
})
export class BetsModule {}
