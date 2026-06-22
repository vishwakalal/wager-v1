import { ConflictException, Injectable } from "@nestjs/common";
import { TransactionType } from "@prisma/client";
import { type Cents, legsFor } from "@wager/shared";
import { LedgerService } from "./ledger.service";
import { WalletService } from "./wallet.service";

export interface SettlementLeg {
  userId: string;
  amount: Cents;
}

/**
 * Internal escrow movements used by the betting lifecycle (no external money
 * leg). `hold` locks available funds when a user stakes; `release` returns them
 * on void/refund; `payout` settles a resolved bet by moving held stakes into
 * winners' available. All go through the same double-entry ledger.
 */
@Injectable()
export class EscrowService {
  constructor(
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
  ) {}

  /** Lock `amount` from available into held (e.g. placing a stake). */
  async hold(
    userId: string,
    amount: Cents,
    idempotencyKey?: string,
  ): Promise<void> {
    const walletId = await this.wallets.ensureWallet(userId);
    const balance = await this.ledger.deriveBalance(walletId);
    if (balance.available < amount) {
      throw new ConflictException("insufficient available balance to hold");
    }
    await this.ledger.record({
      type: TransactionType.HOLD,
      legs: legsFor({ type: "hold", wallet: walletId, amount }),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      metadata: { kind: "hold", userId },
    });
  }

  /** Return `amount` from held back to available (e.g. void/refund). */
  async release(
    userId: string,
    amount: Cents,
    idempotencyKey?: string,
  ): Promise<void> {
    const walletId = await this.wallets.ensureWallet(userId);
    const balance = await this.ledger.deriveBalance(walletId);
    if (balance.held < amount) {
      throw new ConflictException("insufficient held balance to release");
    }
    await this.ledger.record({
      type: TransactionType.RELEASE,
      legs: legsFor({ type: "release", wallet: walletId, amount }),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      metadata: { kind: "release", userId },
    });
  }

  /**
   * Settle a resolved bet: remove `debits` from held and add `credits` to
   * available. The caller (resolution logic) computes the amounts via the
   * parimutuel functions in `@wager/shared`; total debited must equal total
   * credited (enforced by `legsFor`).
   */
  async payout(params: {
    debits: SettlementLeg[];
    credits: SettlementLeg[];
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const walletIdByUser = new Map<string, string>();
    const resolve = async (userId: string): Promise<string> => {
      const cached = walletIdByUser.get(userId);
      if (cached) return cached;
      const walletId = await this.wallets.ensureWallet(userId);
      walletIdByUser.set(userId, walletId);
      return walletId;
    };

    const debits = await Promise.all(
      params.debits.map(async (d) => ({
        wallet: await resolve(d.userId),
        amount: d.amount,
      })),
    );
    const credits = await Promise.all(
      params.credits.map(async (c) => ({
        wallet: await resolve(c.userId),
        amount: c.amount,
      })),
    );

    await this.ledger.record({
      type: TransactionType.PAYOUT,
      legs: legsFor({ type: "payout", debits, credits }),
      ...(params.idempotencyKey !== undefined
        ? { idempotencyKey: params.idempotencyKey }
        : {}),
      metadata: { kind: "payout", ...(params.metadata ?? {}) },
    });
  }
}
