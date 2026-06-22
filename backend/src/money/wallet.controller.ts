import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Cents } from "@wager/shared";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { PhoneVerifiedGuard } from "../auth/phone-verified.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WalletService, type WalletBalance } from "./wallet.service";

interface AmountBody {
  /** Integer cents. */
  amount: Cents;
  /** Optional client-supplied key making the request safe to retry. */
  idempotencyKey?: string;
}

/**
 * Wallet API. All endpoints require a verified Clerk session and completed
 * phone verification (spec §9.2: account must be fully activated).
 */
@Controller("wallet")
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  getBalance(@CurrentUser() user: User): Promise<WalletBalance> {
    return this.wallets.getBalance(user.id);
  }

  @Post("deposit")
  deposit(
    @CurrentUser() user: User,
    @Body() body: AmountBody,
  ): Promise<WalletBalance> {
    if (!body.amount) throw new BadRequestException("amount is required");
    return this.wallets.deposit(user.id, body.amount, body.idempotencyKey);
  }

  @Post("withdraw")
  withdraw(
    @CurrentUser() user: User,
    @Body() body: AmountBody,
  ): Promise<WalletBalance> {
    if (!body.amount) throw new BadRequestException("amount is required");
    return this.wallets.withdraw(user.id, body.amount, body.idempotencyKey);
  }
}
