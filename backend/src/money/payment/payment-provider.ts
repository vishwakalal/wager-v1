import type { Cents } from "@wager/shared";

/**
 * The money mode the platform runs in. v1 runs entirely on `virtual` currency;
 * `stripe` (real money via Stripe Connect) is added later by implementing a
 * second provider — with ZERO changes to bet/stake/resolution/ledger logic.
 */
export type MoneyMode = "virtual" | "stripe";

/** DI token for the active PaymentProvider (chosen by MONEY_MODE at startup). */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export interface PaymentRequest {
  userId: string;
  amount: Cents;
  /** Optional caller reference (e.g. an idempotency key) for the external leg. */
  reference?: string;
}

export interface PaymentResult {
  /** Provider-side reference for the external movement (audit trail). */
  externalRef: string;
}

/**
 * Abstraction over the EXTERNAL leg of money movement — getting funds into and
 * out of the platform. The internal double-entry ledger is provider-agnostic:
 * it records the same legs no matter which provider ran. Today: VirtualProvider.
 * Later: StripeConnectProvider.
 */
export interface PaymentProvider {
  readonly mode: MoneyMode;
  /** Bring `amount` into the platform for a user (e.g. card charge). */
  initiateDeposit(req: PaymentRequest): Promise<PaymentResult>;
  /** Send `amount` out of the platform to a user (e.g. payout/transfer). */
  initiateWithdrawal(req: PaymentRequest): Promise<PaymentResult>;
}
