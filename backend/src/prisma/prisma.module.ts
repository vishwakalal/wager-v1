import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Global so any module can inject the single shared Prisma connection. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
