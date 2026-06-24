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
import { VerificationService } from "./verification.service";
import { DisputeService } from "./dispute.service";
import { CancellationService } from "./cancellation.service";

@Controller()
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class BetsController {
  constructor(
    private readonly bets: BetsService,
    private readonly line: LineService,
    private readonly staking: StakingService,
    private readonly verification: VerificationService,
    private readonly disputes: DisputeService,
    private readonly cancellation: CancellationService,
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

  // ─── Verification events (spec §6) ─────────────────────────────────────────

  /**
   * Submit a new verification event for a bet (e.g. "I went to the gym" or
   * the numeric outcome). Only staked members who joined before the bet started.
   */
  @Post("bets/:id/events")
  @HttpCode(200)
  submitEvent(
    @CurrentUser() user: User,
    @Param("id") betId: string,
    @Body() body: { description?: string; numericValue?: number },
  ) {
    if (!body.description?.trim()) {
      throw new BadRequestException("description is required");
    }
    return this.verification.submitEvent(betId, user.id, body.description, body.numericValue);
  }

  /** List all verification events for a bet (any circle member can view). */
  @Get("bets/:id/events")
  listEvents(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.verification.listEvents(betId, user.id);
  }

  /**
   * Cast an initial vote on a verification event.
   * Choice must be "verify" or "deny". Immutable once submitted.
   */
  @Post("events/:eventId/vote")
  @HttpCode(200)
  castVote(
    @CurrentUser() user: User,
    @Param("eventId") eventId: string,
    @Body() body: { choice?: string },
  ) {
    if (!body.choice) throw new BadRequestException('choice is required ("verify" or "deny")');
    return this.verification.castVote(eventId, user.id, body.choice);
  }

  /**
   * Cast or change a vote during the 30-min tiebreaker window (spec §6.2).
   * Allowed to change your vote until the window closes.
   */
  @Post("events/:eventId/tiebreaker-vote")
  @HttpCode(200)
  castTiebreakerVote(
    @CurrentUser() user: User,
    @Param("eventId") eventId: string,
    @Body() body: { choice?: string },
  ) {
    if (!body.choice) throw new BadRequestException('choice is required ("verify" or "deny")');
    return this.verification.castTiebreakerVote(eventId, user.id, body.choice);
  }

  // ─── Disputes (spec §7.2) ──────────────────────────────────────────────────

  /**
   * Raise a dispute during the 24-h post-expiration window.
   * type "add": flag an event that occurred but was never submitted.
   * type "remove": challenge an already-verified event (requires targetEventId).
   */
  @Post("bets/:id/disputes")
  @HttpCode(200)
  raiseDispute(
    @CurrentUser() user: User,
    @Param("id") betId: string,
    @Body() body: { type?: string; description?: string; targetEventId?: string },
  ) {
    if (!body.type) throw new BadRequestException('type is required ("add" or "remove")');
    if (!body.description?.trim()) throw new BadRequestException("description is required");
    return this.disputes.raiseDispute(betId, user.id, body.type, body.description, body.targetEventId);
  }

  /** List all disputes for a bet (any circle member can view). */
  @Get("bets/:id/disputes")
  listDisputes(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.disputes.listDisputes(betId, user.id);
  }

  /**
   * Vote on a dispute. inFavor=true supports the dispute; inFavor=false opposes it.
   * 70%+ in favor → immediately confirmed and the event is added/removed.
   */
  @Post("disputes/:disputeId/vote")
  @HttpCode(200)
  castDisputeVote(
    @CurrentUser() user: User,
    @Param("disputeId") disputeId: string,
    @Body() body: { inFavor?: boolean },
  ) {
    if (body.inFavor === undefined || body.inFavor === null) {
      throw new BadRequestException("inFavor (boolean) is required");
    }
    return this.disputes.castVote(disputeId, user.id, body.inFavor);
  }

  // ─── Cancellation (spec §8) ─────────────────────────────────────────────────

  /**
   * Creator cancels the bet unilaterally at any lifecycle point.
   * All stakers are refunded immediately; irreversible.
   */
  @Post("bets/:id/cancel")
  @HttpCode(200)
  cancelBet(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.cancellation.cancelByCreator(betId, user.id);
  }

  /**
   * Staker votes to cancel the bet (spec §8). Immutable once cast.
   * When 50%+ of stakers have voted, cancellation fires immediately.
   */
  @Post("bets/:id/cancel-vote")
  @HttpCode(200)
  voteToCancelBet(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.cancellation.voteToCancelBet(betId, user.id);
  }

  /** List all cancellation votes for a bet (any circle member can view). */
  @Get("bets/:id/cancel-votes")
  listCancelVotes(@CurrentUser() user: User, @Param("id") betId: string) {
    return this.cancellation.listCancelVotes(betId, user.id);
  }
}
