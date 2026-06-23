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

@Controller()
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class BetsController {
  constructor(
    private readonly bets: BetsService,
    private readonly line: LineService,
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
}
