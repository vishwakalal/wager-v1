import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { TransactionType, WalletKind } from "@prisma/client";
import { type Balance, type Cents, MIN_WITHDRAWAL, legsFor } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { LedgerService, SYSTEM_WALLET_ID } from "./ledger.service";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment/payment-provider";

export interface WalletBalance extends Balance {
  total: Cents;
}

/**
 * High-level wallet operations: balance, deposit, withdraw. Deposits/withdrawals
 * run the external leg through the active PaymentProvider, then record the
 * internal double-entry movement via the LedgerService. Balances are always
 * derived from the ledger — never stored.
 */
@Injectable()
export class WalletService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  /** Ensure the singleton SYSTEM wallet exists (external counterparty). */
  async onModuleInit(): Promise<void> {
    await this.prisma.wallet.upsert({
      where: { id: SYSTEM_WALLET_ID },
      create: { id: SYSTEM_WALLET_ID, kind: WalletKind.SYSTEM },
      update: {},
    });
  }

  /** Get (creating on first use) the wallet id for a user. */
  async ensureWallet(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`no such user: ${userId}`);
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId, kind: WalletKind.USER },
      update: {},
    });
    return wallet.id;
  }

  async getBalance(userId: string): Promise<WalletBalance> {
    const walletId = await this.ensureWallet(userId);
    const balance = await this.ledger.deriveBalance(walletId);
    return { ...balance, total: balance.available + balance.held };
  }

  async deposit(
    userId: string,
    amount: Cents,
    idempotencyKey?: string,
  ): Promise<WalletBalance> {
    this.assertAmount(amount);
    const walletId = await this.ensureWallet(userId);

    const reference = idempotencyKey ?? undefined;
    const { externalRef } = await this.payments.initiateDeposit({
      userId,
      amount,
      ...(reference !== undefined ? { reference } : {}),
    });

    await this.ledger.record({
      type: TransactionType.DEPOSIT,
      legs: legsFor({ type: "deposit", wallet: walletId, amount }),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      metadata: { kind: "deposit", externalRef, mode: this.payments.mode },
    });

    return this.getBalance(userId);
  }

  async withdraw(
    userId: string,
    amount: Cents,
    idempotencyKey?: string,
  ): Promise<WalletBalance> {
    this.assertAmount(amount);
    if (amount < MIN_WITHDRAWAL) {
      throw new BadRequestException(
        `minimum withdrawal is ${MIN_WITHDRAWAL} cents`,
      );
    }

    const walletId = await this.ensureWallet(userId);
    const balance = await this.ledger.deriveBalance(walletId);
    if (balance.available < amount) {
      throw new ConflictException("insufficient available balance");
    }

    const reference = idempotencyKey ?? undefined;
    const { externalRef } = await this.payments.initiateWithdrawal({
      userId,
      amount,
      ...(reference !== undefined ? { reference } : {}),
    });

    await this.ledger.record({
      type: TransactionType.WITHDRAWAL,
      legs: legsFor({ type: "withdraw", wallet: walletId, amount }),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      metadata: { kind: "withdrawal", externalRef, mode: this.payments.mode },
    });

    return this.getBalance(userId);
  }

  private assertAmount(amount: Cents): void {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException("amount must be a positive integer (cents)");
    }
  }
}
