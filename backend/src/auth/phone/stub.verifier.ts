import { Logger } from "@nestjs/common";
import { OTP_EXPIRY_MS, OTP_MAX_ATTEMPTS } from "@wager/shared";
import type { Redis } from "@upstash/redis";
import type { OtpResult, PhoneVerifier } from "./phone-verifier";

interface OtpState {
  phone: string;
  attempts: number;
  expiresAt: number;
}

/**
 * Development/test OTP verifier. Never sends a real SMS — logs the code to
 * the console. The code is always OTP_STUB_CODE (default "123456"), set via
 * the environment variable of the same name. All attempt and expiry rules
 * (spec §9.2) are enforced exactly as production would, so tests exercise the
 * real guard logic.
 */
export class StubVerifier implements PhoneVerifier {
  private readonly logger = new Logger(StubVerifier.name);
  private readonly stubCode: string;
  private readonly ttlSec: number;

  constructor(
    private readonly redis: Redis,
    stubCode?: string,
  ) {
    this.stubCode = stubCode ?? process.env["OTP_STUB_CODE"] ?? "123456";
    this.ttlSec = Math.ceil(OTP_EXPIRY_MS / 1000);
  }

  private key(userId: string): string {
    return `otp:${userId}`;
  }

  async send(userId: string, phone: string): Promise<void> {
    const state: OtpState = {
      phone,
      attempts: 0,
      expiresAt: Date.now() + OTP_EXPIRY_MS,
    };
    await this.redis.set(this.key(userId), JSON.stringify(state), {
      ex: this.ttlSec,
    });
    this.logger.debug(`[STUB OTP] ${phone} → ${this.stubCode}`);
  }

  async verify(userId: string, code: string): Promise<OtpResult> {
    const raw = await this.redis.get<string>(this.key(userId));
    if (!raw) return { success: false, error: "expired" };

    const state: OtpState =
      typeof raw === "string" ? (JSON.parse(raw) as OtpState) : (raw as OtpState);

    if (Date.now() > state.expiresAt) {
      await this.redis.del(this.key(userId));
      return { success: false, error: "expired" };
    }

    if (state.attempts >= OTP_MAX_ATTEMPTS) {
      await this.redis.del(this.key(userId));
      return { success: false, error: "max_attempts" };
    }

    if (code !== this.stubCode) {
      const ttlRemaining = Math.ceil((state.expiresAt - Date.now()) / 1000);
      const updated: OtpState = { ...state, attempts: state.attempts + 1 };
      await this.redis.set(this.key(userId), JSON.stringify(updated), {
        ex: Math.max(ttlRemaining, 1),
      });
      return { success: false, error: "invalid_code" };
    }

    await this.redis.del(this.key(userId));
    return { success: true };
  }
}
