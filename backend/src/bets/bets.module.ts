import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MoneyModule } from "../money/money.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { BetsService } from "./bets.service";
import { BetsController } from "./bets.controller";
import { LineService } from "./line.service";
import { StakingService } from "./staking.service";

@Module({
  imports: [PrismaModule, MoneyModule, SchedulerModule],
  providers: [BetsService, LineService, StakingService],
  controllers: [BetsController],
  exports: [BetsService],
})
export class BetsModule {}
