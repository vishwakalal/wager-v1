import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SchedulerModule } from "../scheduler/scheduler.module";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";

@Module({
  imports: [AuthModule, SchedulerModule],
  providers: [NotificationService],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
