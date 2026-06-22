import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ClerkAuthGuard } from "./clerk.guard";
import { PhoneVerifiedGuard } from "./phone-verified.guard";
import { PHONE_VERIFIER, type PhoneVerifier } from "./phone/phone-verifier";
import { StubVerifier } from "./phone/stub.verifier";
import { MoneyModule } from "../money/money.module";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";

/**
 * Auth domain: Clerk JWT verification, phone OTP, account lifecycle.
 * Exports ClerkAuthGuard and PhoneVerifiedGuard so other modules can apply
 * them to their controllers without taking a full AuthModule dependency.
 */
@Module({
  imports: [MoneyModule, RedisModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    ClerkAuthGuard,
    PhoneVerifiedGuard,
    {
      provide: PHONE_VERIFIER,
      inject: [ConfigService, RedisService],
      useFactory: (
        config: ConfigService,
        redis: RedisService,
      ): PhoneVerifier => {
        const mode = config.get<string>("PHONE_VERIFIER") ?? "stub";
        if (mode === "stub") {
          const stubCode = config.get<string>("OTP_STUB_CODE");
          return new StubVerifier(redis.client, stubCode);
        }
        throw new Error(
          `PHONE_VERIFIER="${mode}" is not implemented yet (only "stub" exists in v1)`,
        );
      },
    },
  ],
  exports: [AuthService, ClerkAuthGuard, PhoneVerifiedGuard],
})
export class AuthModule {}
