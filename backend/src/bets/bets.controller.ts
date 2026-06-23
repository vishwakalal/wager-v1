import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { PhoneVerifiedGuard } from "../auth/phone-verified.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BetsService } from "./bets.service";
import { LineService } from "./line.service";
import { StakingService } from "./staking.service";

@Controller()
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class BetsController {
  constructor(
    private readonly bets: BetsService,
    private readonly line: LineService,
    private readonly staking: StakingService,
  ) {}

  // ─── Bet CRUD ───────────────────────────────────────────────────────────────

  /** Create a bet inside a circle. NUMERIC starts in LINE_SETTING; BINARY goes straight to STAKING. */
  @Post("circles/:circleId/bets")
  createBet(
    @CurrentUser() user: User,
    @Param("circleId") circleId: string,
    @Body() body: { type?: string; duration?: string; description?: string },
  ) {
    if (!body.type || !body.duration || !body.description?.trim()) {
      throw new BadRequestException("type, duration, and description are required");
    }
    return this.bets.create(circleId, user.id, {
      type: body.type,
      duration: body.duration,
      description: body.description,
    });
  }

  /** List all bets in a circle (caller must be a member). */
  @Get("circles/:circleId/bets")
  listBets(@CurrentUser() user: User, @Param("circleId") circleId: string) {
    return this.bets.listByCircle(circleId, user.id);
  }

  /** Get a bet by ID with per-caller metadata (submission status, counts). */
  @Get("bets/:id")
  getBet(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.bets.getById(betId, user.id);
  }

  // ─── Line setting (NUMERIC only) ───────────────────────────────────────────

  /**
   * Submit a blind line value. Hidden from everyone until revealed.
   * Auto-reveals once every eligible member has submitted.
   */
  @Post("bets/:id/line/submit")
  @HttpCode(200)
  submitLine(
    @CurrentUser() user: User,
    @Param("id") betId: string,
    @Body() body: { value?: number },
  ) {
    if (body.value === undefined || body.value === null) {
      throw new BadRequestException("value is required");
    }
    if (typeof body.value !== "number") {
      throw new BadRequestException("value must be a number");
    }
    return this.line.submitValue(betId, user.id, body.value);
  }

  /**
   * Creator reveals the line early (before all members have submitted).
   * Computes trimmed mean, opens 30-min challenge window.
   */
  @Post("bets/:id/line/reveal")
  @HttpCode(200)
  revealLine(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.line.reveal(betId, user.id);
  }

  /**
   * Cast a dispute vote against the revealed line.
   * If ≥50% of eligible members dispute, everyone resubmits (new round).
   */
  @Post("bets/:id/line/dispute")
  @HttpCode(200)
  disputeLine(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.line.disputeRevealedLine(betId, user.id);
  }

  // ─── Staking ───────────────────────────────────────────────────────────────

  /**
   * Place a stake. Amount is in cents (integer). Side: "over"/"under" for
   * numeric bets, "yes"/"no" for binary. One stake per user per bet.
   * Funds are held in escrow immediately; cap refunds issued at window close.
   */
  @Post("bets/:id/stake")
  @HttpCode(200)
  placeStake(
    @CurrentUser() user: User,
    @Param("id") betId: string,
    @Body() body: { side?: string; amount?: number },
  ) {
    if (!body.side) throw new BadRequestException("side is required");
    if (body.amount === undefined || body.amount === null) {
      throw new BadRequestException("amount is required (cents)");
    }
    return this.staking.placeStake(betId, user.id, body.side, body.amount);
  }

  /** The caller's current stake on this bet, or null. */
  @Get("bets/:id/my-stake")
  getMyStake(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.staking.getMyStake(betId, user.id);
  }

  /**
   * Pool sizes (always visible) and locked odds (after staking closes).
   * Odds are parimutuel implied multipliers: e.g. odds.over = 1.75 means
   * a $100 stake on over pays out $175 if over wins.
   */
  @Get("bets/:id/odds")
  getOdds(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.staking.getOdds(betId, user.id);
  }
}
