import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { BetsService } from "./bets.service";
import { BetsController } from "./bets.controller";
import { LineService } from "./line.service";

@Module({
  imports: [PrismaModule, SchedulerModule],
  providers: [BetsService, LineService],
  controllers: [BetsController],
  exports: [BetsService],
})
export class BetsModule {}
