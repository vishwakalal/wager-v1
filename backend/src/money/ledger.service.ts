import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Bucket, Prisma, TransactionType } from "@prisma/client";
import { EXTERNAL_ACCOUNT, type Balance, type LedgerLeg, ledgerSum } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";

/** Fixed id of the singleton SYSTEM wallet (the external counterparty). */
export const SYSTEM_WALLET_ID = "system";

function toBucketEnum(bucket: LedgerLeg["bucket"]): Bucket {
  return bucket === "available" ? Bucket.AVAILABLE : Bucket.HELD;
}

export interface RecordResult {
  transactionId: string;
  /** True when an existing transaction with the same idempotency key was reused. */
  idempotentReplay: boolean;
}

/**
 * The only writer to the append-only ledger. Translates the pure legs produced
 * by `@wager/shared` into persisted Transaction + LedgerEntry rows, atomically,
 * and re-checks the invariants (balances to zero, no wallet driven negative)
 * inside the DB transaction so they hold regardless of caller.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Map the shared EXTERNAL_ACCOUNT sentinel to the real SYSTEM wallet id. */
  private resolveAccount(account: string): string {
    return account === EXTERNAL_ACCOUNT ? SYSTEM_WALLET_ID : account;
  }

  /** Derive a wallet's available/held balance by summing its ledger entries. */
  async deriveBalance(
    walletId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Balance> {
    const grouped = await client.ledgerEntry.groupBy({
      by: ["bucket"],
      where: { walletId },
      _sum: { amount: true },
    });
    let available = 0;
    let held = 0;
    for (const row of grouped) {
      const sum = row._sum.amount ?? 0;
      if (row.bucket === Bucket.AVAILABLE) available = sum;
      else held = sum;
    }
    return { available, held };
  }

  /**
   * Persist a balanced set of legs as a single transaction, atomically and
   * idempotently. Returns the transaction id (reusing an existing one when the
   * same idempotency key was already applied).
   */
  async record(params: {
    type: TransactionType;
    legs: LedgerLeg[];
    idempotencyKey?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<RecordResult> {
    const { type, legs, idempotencyKey, metadata } = params;

    if (legs.length === 0) throw new BadRequestException("no ledger legs to record");
    if (ledgerSum(legs) !== 0) {
      throw new BadRequestException("ledger legs do not balance to zero");
    }

    if (idempotencyKey) {
      const existing = await this.prisma.transaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return { transactionId: existing.id, idempotentReplay: true };
    }

    const resolved = legs.map((leg) => ({
      ...leg,
      account: this.resolveAccount(leg.account),
    }));

    try {
      const transactionId = await this.prisma.$transaction(async (db) => {
        if (idempotencyKey) {
          const existing = await db.transaction.findUnique({
            where: { idempotencyKey },
          });
          if (existing) return existing.id;
        }

        // Re-validate non-negativity for each affected USER wallet after applying
        // the legs. The SYSTEM wallet's external float is intentionally exempt.
        const affected = [...new Set(resolved.map((leg) => leg.account))];
        for (const walletId of affected) {
          if (walletId === SYSTEM_WALLET_ID) continue;
          const balance = await this.deriveBalance(walletId, db);
          let { available, held } = balance;
          for (const leg of resolved) {
            if (leg.account !== walletId) continue;
            if (leg.bucket === "available") available += leg.amount;
            else held += leg.amount;
          }
          if (available < 0 || held < 0) {
            throw new ConflictException(
              `insufficient funds: wallet ${walletId} would go negative`,
            );
          }
        }

        const created = await db.transaction.create({
          data: {
            type,
            idempotencyKey: idempotencyKey ?? null,
            metadata: metadata ?? Prisma.JsonNull,
            entries: {
              create: resolved.map((leg) => ({
                walletId: leg.account,
                bucket: toBucketEnum(leg.bucket),
                amount: leg.amount,
              })),
            },
          },
        });
        return created.id;
      });
      return { transactionId, idempotentReplay: false };
    } catch (error) {
      // Lost an idempotency-key race: another request inserted first.
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.transaction.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return { transactionId: existing.id, idempotentReplay: true };
      }
      throw error;
    }
  }
}
