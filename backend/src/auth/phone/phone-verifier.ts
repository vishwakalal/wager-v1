export type OtpError = "invalid_code" | "expired" | "max_attempts";

export interface OtpResult {
  success: boolean;
  error?: OtpError;
}

/**
 * Abstraction over SMS OTP delivery + verification. In dev/test this is the
 * StubVerifier (fixed code, Redis-backed state). In production it will be a
 * TwilioVerifier. Rules are spec §9.2:
 *   - 10-min expiry
 *   - max 3 failed attempts, then the pending OTP is invalidated
 *   - one phone per account globally (enforced by AuthService, not here)
 */
export interface PhoneVerifier {
  /** Generate and deliver an OTP for `phone`, keyed to `userId`. */
  send(userId: string, phone: string): Promise<void>;
  /** Attempt to verify `code` for the pending OTP tied to `userId`. */
  verify(userId: string, code: string): Promise<OtpResult>;
}

export const PHONE_VERIFIER = Symbol("PHONE_VERIFIER");
