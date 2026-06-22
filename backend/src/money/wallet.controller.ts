import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
} from "@nestjs/common";
import type { Cents } from "@wager/shared";
import { WalletService, type WalletBalance } from "./wallet.service";

interface AmountBody {
  /** Integer cents. */
  amount: Cents;
  /** Optional client-supplied key making the request safe to retry. */
  idempotencyKey?: string;
}

/**
 * Wallet API. Auth arrives in Phase 2 — until then the caller identifies the
 * user with an `x-user-id` header (dev stub). Every money-moving endpoint is
 * idempotent when given an `idempotencyKey`.
 */
@Controller("wallet")
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  getBalance(@Headers("x-user-id") userId?: string): Promise<WalletBalance> {
    return this.wallets.getBalance(this.requireUser(userId));
  }

  @Post("deposit")
  deposit(
    @Headers("x-user-id") userId: string | undefined,
    @Body() body: AmountBody,
  ): Promise<WalletBalance> {
    return this.wallets.deposit(
      this.requireUser(userId),
      body.amount,
      body.idempotencyKey,
    );
  }

  @Post("withdraw")
  withdraw(
    @Headers("x-user-id") userId: string | undefined,
    @Body() body: AmountBody,
  ): Promise<WalletBalance> {
    return this.wallets.withdraw(
      this.requireUser(userId),
      body.amount,
      body.idempotencyKey,
    );
  }

  private requireUser(userId?: string): string {
    if (!userId) throw new BadRequestException("missing x-user-id header");
    return userId;
  }
}
