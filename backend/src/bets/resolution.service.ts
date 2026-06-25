import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  BetStatus,
  BetType,
  DisputeStatus,
  JobType,
  StakeSide,
  VerificationStatus,
  type Stake,
  type Bet,
} from "@prisma/client";
import {
  computeParimutuelPayouts,
  POST_EXPIRATION_WINDOW_MS,
  DISPUTE_CLOSING_WARNING_MS,
  RAKE_BPS,
} from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EscrowService } from "../money/escrow.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { RealtimeService } from "../realtime/realtime.service";
import { NotificationService } from "../notifications/notification.service";
import { NotificationTrigger } from "@prisma/client";

@Injectable()
export class ResolutionService implements OnModuleInit {
  private readonly logger = new Logger(ResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly scheduler: SchedulerService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.scheduler.registerHandler(JobType.BET_EXPIRE, (p) =>
      this.expireBet(p["betId"] as string),
    );
    this.scheduler.registerHandler(JobType.DISPUTE_CLOSE, (p) =>
      this.closeDispute(p["betId"] as string),
    );
  }

  // ─── BET_EXPIRE ────────────────────────────────────────────────────────────

  /**
   * Soft-close the bet: ACTIVE → CLOSED; open the 24h dispute window (spec §5.2).
   * No new verification events can be submitted after this.
   */
  async expireBet(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet || bet.status !== BetStatus.ACTIVE) return; // idempotent

    const closedAt = new Date();
    const disputeCloseAt = new Date(closedAt.getTime() + POST_EXPIRATION_WINDOW_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.bet.update({
        where: { id: betId },
        data: { status: BetStatus.CLOSED, closedAt },
      });
      await this.scheduler.schedule(JobType.DISPUTE_CLOSE, disputeCloseAt, { betId }, tx);
      const warningAt = new Date(disputeCloseAt.getTime() - DISPUTE_CLOSING_WARNING_MS);
      if (warningAt > closedAt) {
        await this.scheduler.schedule(JobType.DISPUTE_WARNING, warningAt, { betId }, tx);
      }
    });

    this.logger.log(`bet ${betId}: ACTIVE → CLOSED (dispute window closes ${disputeCloseAt.toISOString()})`);
    this.realtime.emitToBet(betId, "bet:status_changed", { betId, status: "CLOSED" });

    const stakerIds = (await this.prisma.stake.findMany({ where: { betId }, select: { userId: true } }))
      .map((s) => s.userId);
    void this.notifications.send(stakerIds, NotificationTrigger.BET_EXPIRED, {
      title: "Bet expired — dispute window open",
      body: `"${bet.description}" has ended. You have 24 hours to raise a dispute.`,
      data: { betId },
    });
  }

  // ─── DISPUTE_CLOSE ────────────────────────────────────────────────────────

  /**
   * 24-h window closed: finalize pending verifications, check disputes, pay out.
   * - Any PENDING dispute at close → VOID (spec §7.3)
   * - Otherwise: compute outcome from verified events and pay winners (spec §7.1)
   */
  async closeDispute(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet || bet.status !== BetStatus.CLOSED) return; // idempotent

    const stakes = await this.prisma.stake.findMany({ where: { betId } });
    const pendingDisputeCount = await this.prisma.dispute.count({
      where: { betId, status: DisputeStatus.PENDING },
    });

    if (pendingDisputeCount > 0) {
      this.logger.log(`bet ${betId}: ${pendingDisputeCount} unresolved dispute(s) at close → VOID`);
      await this.voidAllStakes(bet, stakes, "unresolved-dispute");
      return;
    }

    const winningSide = await this.computeOutcome(bet);
    if (!winningSide) {
      this.logger.log(`bet ${betId}: outcome is a push → VOID`);
      await this.voidAllStakes(bet, stakes, "push");
      return;
    }

    await this.payoutWinners(bet, stakes, winningSide);
  }

  // ─── Outcome computation ────────────────────────────────────────────────────

  /**
   * Determine the winning side from verified events.
   * Returns null for a push/tie (numeric exact-match or no events in an ambiguous state).
   */
  private async computeOutcome(bet: Bet): Promise<StakeSide | null> {
    const verifiedEvents = await this.prisma.verificationEvent.findMany({
      where: { betId: bet.id, status: VerificationStatus.VERIFIED },
    });

    if (bet.type === BetType.BINARY) {
      // YES wins if ANY event was ever verified (spec §7.1)
      return verifiedEvents.length > 0 ? StakeSide.YES : StakeSide.NO;
    }

    // NUMERIC: compare final verified value against the set line (spec §7.1)
    if (!bet.line) {
      // No line was ever set (shouldn't happen if bet is CLOSED, but guard anyway)
      return null;
    }

    const setLine = bet.line.toNumber();
    const finalValue = this.aggregateVerifiedValue(verifiedEvents);

    if (finalValue > setLine)  return StakeSide.OVER;
    if (finalValue < setLine)  return StakeSide.UNDER;
    return null; // exact push → void
  }

  /**
   * Derive the final numeric outcome from verified events:
   * - Events with numericValues → average of those values
   * - Events without numericValues → count of verified events
   */
  private aggregateVerifiedValue(
    events: Array<{ numericValue: { toNumber(): number } | null }>,
  ): number {
    const withValues = events.filter((e) => e.numericValue !== null);
    if (withValues.length > 0) {
      const sum = withValues.reduce((acc, e) => acc + e.numericValue!.toNumber(), 0);
      return sum / withValues.length;
    }
    return events.length;
  }

  // ─── Void ─────────────────────────────────────────────────────────────────

  private async voidAllStakes(bet: Bet, stakes: Stake[], reason: string): Promise<void> {
    for (const s of stakes) {
      const effective = s.effectiveAmount ?? s.amount;
      await this.escrow.release(s.userId, effective, `resolve:void:${bet.id}:${s.id}`);
    }
    await this.prisma.bet.update({
      where: { id: bet.id },
      data: { status: BetStatus.VOIDED, resolvedAt: new Date() },
    });
    this.logger.log(`bet ${bet.id}: VOIDED (${reason}), refunded ${stakes.length} stakers`);
    this.realtime.emitToBet(bet.id, "bet:status_changed", { betId: bet.id, status: "VOIDED" });
    void this.notifications.send(
      stakes.map((s) => s.userId),
      NotificationTrigger.BET_VOIDED,
      { title: "Bet voided — stake refunded", body: `"${bet.description}" was voided. Your stake has been refunded.`, data: { betId: bet.id } },
    );
  }

  // ─── Payout ───────────────────────────────────────────────────────────────

  private async payoutWinners(bet: Bet, stakes: Stake[], winningSide: StakeSide): Promise<void> {
    const winnerStakes = stakes.filter((s) => s.side === winningSide);
    const loserStakes  = stakes.filter((s) => s.side !== winningSide);

    const losingPoolTotal = loserStakes.reduce((sum, s) => sum + (s.effectiveAmount ?? s.amount), 0);

    const result = computeParimutuelPayouts(
      winnerStakes.map((s) => ({ userId: s.userId, stake: s.effectiveAmount ?? s.amount })),
      losingPoolTotal,
      RAKE_BPS,
    );

    // Debits: release HELD funds for ALL stakers (winners get stake back + winnings; losers lose stake)
    const debits = stakes.map((s) => ({
      userId: s.userId,
      amount: s.effectiveAmount ?? s.amount,
    }));

    // Credits: winners' total payouts (stake + winnings)
    const credits = result.payouts.map((p) => ({ userId: p.userId, amount: p.payout }));

    await this.escrow.payout({
      debits,
      credits,
      idempotencyKey: `resolve:payout:${bet.id}`,
      metadata: { betId: bet.id, winningSide, rake: result.rake },
    });

    await this.prisma.bet.update({
      where: { id: bet.id },
      data: { status: BetStatus.RESOLVED, winSide: winningSide, resolvedAt: new Date() },
    });

    this.logger.log(
      `bet ${bet.id}: RESOLVED → ${winningSide} wins; ` +
      `paid out ${result.payouts.length} winners from ${losingPoolTotal}¢ losing pool`,
    );
    this.realtime.emitToBet(bet.id, "bet:status_changed", { betId: bet.id, status: "RESOLVED", winningSide });

    const winnerIds = winnerStakes.map((s) => s.userId);
    const loserIds  = loserStakes.map((s) => s.userId);

    void this.notifications.send(winnerIds, NotificationTrigger.BET_RESOLVED_WON, {
      title: "You won!",
      body: `"${bet.description}" resolved in your favour.`,
      data: { betId: bet.id },
    });
    void this.notifications.send(loserIds, NotificationTrigger.BET_RESOLVED_LOST, {
      title: "Bet resolved",
      body: `"${bet.description}" didn't go your way this time.`,
      data: { betId: bet.id },
    });
    void this.notifications.send(winnerIds, NotificationTrigger.PAYMENT_PAYOUT, {
      title: "Payout credited",
      body: `Your winnings from "${bet.description}" have been credited to your balance.`,
      data: { betId: bet.id },
    });
  }
}
