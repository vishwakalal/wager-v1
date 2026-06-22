import { Module } from "@nestjs/common";
import { CirclesController } from "./circles.controller";
import { CirclesService } from "./circles.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [CirclesController],
  providers: [CirclesService],
  exports: [CirclesService],
})
export class CirclesModule {}
