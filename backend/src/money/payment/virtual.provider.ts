import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import type {
  MoneyMode,
  PaymentProvider,
  PaymentRequest,
  PaymentResult,
} from "./payment-provider";

/**
 * Virtual-money provider used during development and testing. The external leg
 * is a no-op that always succeeds instantly — there is no real money to move.
 * All the accounting still flows through the same ledger, so swapping in the
 * Stripe provider later requires no changes anywhere else.
 */
export class VirtualProvider implements PaymentProvider {
  readonly mode: MoneyMode = "virtual";
  private readonly logger = new Logger(VirtualProvider.name);

  async initiateDeposit(req: PaymentRequest): Promise<PaymentResult> {
    this.logger.debug(`virtual deposit ${req.amount} for ${req.userId}`);
    return { externalRef: `virtual_dep_${randomUUID()}` };
  }

  async initiateWithdrawal(req: PaymentRequest): Promise<PaymentResult> {
    this.logger.debug(`virtual withdrawal ${req.amount} for ${req.userId}`);
    return { externalRef: `virtual_wd_${randomUUID()}` };
  }
}
