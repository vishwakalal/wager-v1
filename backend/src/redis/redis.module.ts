import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

/** Global so any module can inject the shared Redis client. */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
