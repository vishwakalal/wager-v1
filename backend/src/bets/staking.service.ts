import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { BetStatus, BetType, JobType, MemberStatus, StakeSide } from "@prisma/client";
import {
  MIN_STAKE,
  type Side,
  isStakeAboveMinimum,
} from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EscrowService } from "../money/escrow.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { RealtimeService } from "../realtime/realtime.service";

const SIDE_INPUT: Record<string, StakeSide> = {
  over:  StakeSide.OVER,
  under: StakeSide.UNDER,
  yes:   StakeSide.YES,
  no:    StakeSide.NO,
};

function toSharedSide(side: StakeSide): Side {
  switch (side) {
    case StakeSide.OVER:  return "over";
    case StakeSide.UNDER: return "under";
    case StakeSide.YES:   return "yes";
    case StakeSide.NO:    return "no";
  }
}

@Injectable()
export class StakingService implements OnModuleInit {
  private readonly logger = new Logger(StakingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly scheduler: SchedulerService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.scheduler.registerHandler(JobType.STAKING_CLOSE, (payload) =>
      this.closeWindow(payload["betId"] as string),
    );
  }

  /**
   * Place a stake on a bet (spec §4.1, §4.2).
   * Holds the full requested amount from the user's wallet immediately.
   * The 5x relative cap is applied at window close, not here.
   */
  async placeStake(
    betId: string,
    userId: string,
    sideInput: string,
    amountCents: number,
  ) {
    // Validate side
    const side = SIDE_INPUT[sideInput.toLowerCase()];
    if (!side) {
      throw new BadRequestException('side must be "over", "under", "yes", or "no"');
    }

    // Validate amount
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException("amount must be a positive integer (cents)");
    }
    if (!isStakeAboveMinimum(amountCents)) {
      throw new BadRequestException(
        `minimum stake is ${MIN_STAKE} cents ($${(MIN_STAKE / 100).toFixed(2)})`,
      );
    }

    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    if (bet.status !== BetStatus.STAKING) {
      throw new BadRequestException("staking window is not open for this bet");
    }

    // Enforce side ↔ bet type
    if (bet.type === BetType.NUMERIC && (side === StakeSide.YES || side === StakeSide.NO)) {
      throw new BadRequestException('numeric bets use "over" or "under"');
    }
    if (bet.type === BetType.BINARY && (side === StakeSide.OVER || side === StakeSide.UNDER)) {
      throw new BadRequestException('binary bets use "yes" or "no"');
    }

    // Must be eligible (approved member who joined before the bet)
    const membership = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId: bet.circleId, userId } },
    });
    const eligible =
      membership &&
      membership.status === MemberStatus.APPROVED &&
      membership.joinedAt !== null &&
      membership.joinedAt <= bet.createdAt;
    if (!eligible) throw new ForbiddenException("you are not eligible to stake on this bet");

    // One stake per user per bet
    const existing = await this.prisma.stake.findUnique({
      where: { betId_userId: { betId, userId } },
    });
    if (existing) throw new ConflictException("you have already staked on this bet");

    // Hold funds first, then record the stake — if hold fails (insufficient balance)
    // no stake row is created, keeping the two in sync.
    const idempotencyKey = `stake:hold:${betId}:${userId}`;
    await this.escrow.hold(userId, amountCents, idempotencyKey);

    const stake = await this.prisma.stake.create({
      data: { betId, userId, side, amount: amountCents },
    });

    this.logger.log(`bet ${betId}: ${userId} staked ${amountCents}¢ on ${side}`);
    return stake;
  }

  /**
   * Return the calling user's stake for a bet, or null if they haven't staked.
   */
  async getMyStake(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");

    await this.requireMember(bet.circleId, userId);

    return this.prisma.stake.findUnique({ where: { betId_userId: { betId, userId } } });
  }

  /**
   * Return current pool sizes (always) and locked odds (once staking closes).
   * During the staking window the pools are live; after close they reflect the
   * effective (post-cap) amounts and are locked for the bet's lifetime.
   */
  async getOdds(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");

    await this.requireMember(bet.circleId, userId);

    const stakes = await this.prisma.stake.findMany({ where: { betId } });
    const stakingClosed = bet.status !== BetStatus.STAKING &&
      bet.status !== BetStatus.LINE_SETTING &&
      bet.status !== BetStatus.LINE_CHALLENGE;

    if (bet.type === BetType.NUMERIC) {
      // Use effectiveAmount when available (staking closed), otherwise amount
      const overPool  = stakes.filter(s => s.side === StakeSide.OVER)
        .reduce((sum, s) => sum + (stakingClosed ? (s.effectiveAmount ?? 0) : s.amount), 0);
      const underPool = stakes.filter(s => s.side === StakeSide.UNDER)
        .reduce((sum, s) => sum + (stakingClosed ? (s.effectiveAmount ?? 0) : s.amount), 0);

      return {
        stakingOpen: !stakingClosed,
        pools: { over: overPool, under: underPool },
        ...(stakingClosed && overPool > 0 && underPool > 0 ? {
          odds: {
            // Implied payout multiplier: if your side wins, you get back stake × (1 + losing/winning)
            over:  1 + underPool / overPool,
            under: 1 + overPool  / underPool,
          },
        } : {}),
      };
    }

    // Binary
    const yesPool = stakes.filter(s => s.side === StakeSide.YES)
      .reduce((sum, s) => sum + (stakingClosed ? (s.effectiveAmount ?? 0) : s.amount), 0);
    const noPool  = stakes.filter(s => s.side === StakeSide.NO)
      .reduce((sum, s) => sum + (stakingClosed ? (s.effectiveAmount ?? 0) : s.amount), 0);

    return {
      stakingOpen: !stakingClosed,
      pools: { yes: yesPool, no: noPool },
      ...(stakingClosed && yesPool > 0 && noPool > 0 ? {
        odds: {
          yes: 1 + noPool  / yesPool,
          no:  1 + yesPool / noPool,
        },
      } : {}),
    };
  }

  private async requireMember(circleId: string, userId: string): Promise<void> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (!m || m.status !== MemberStatus.APPROVED) {
      throw new ForbiddenException("you are not a member of this circle");
    }
  }

  // ─── Called by SchedulerService ────────────────────────────────────────────

  /**
   * Close the staking window: apply 5x cap, issue refunds, advance to ACTIVE or VOIDED.
   * All ledger operations are idempotent; safe to retry if the job fails mid-way.
   */
  async closeWindow(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet || bet.status !== BetStatus.STAKING) return; // idempotent guard

    const dbStakes = await this.prisma.stake.findMany({ where: { betId } });

    const rawStakes = dbStakes.map((s) => ({
      userId: s.userId,
      side: toSharedSide(s.side),
      amount: s.amount,
    }));

    const { resolveStaking } = await import("@wager/shared");
    const resolution = resolveStaking(rawStakes);

    if (resolution.voided) {
      this.logger.log(`bet ${betId}: staking voided (${resolution.voided}) — refunding all`);

      // Release every stake back to available
      for (const stake of dbStakes) {
        await this.escrow.release(
          stake.userId,
          stake.amount,
          `stake:void:${stake.id}`,
        );
      }

      await this.prisma.bet.update({
        where: { id: betId },
        data: { status: BetStatus.VOIDED },
      });
      return;
    }

    // Apply cap: update Stake rows and release any excess
    for (const capped of resolution.stakes) {
      const dbStake = dbStakes.find((s) => s.userId === capped.userId);
      if (!dbStake) continue;

      await this.prisma.stake.update({
        where: { id: dbStake.id },
        data: { effectiveAmount: capped.effective, refundAmount: capped.refund },
      });

      if (capped.refund > 0) {
        await this.escrow.release(
          capped.userId,
          capped.refund,
          `stake:refund:${dbStake.id}`,
        );
        this.logger.log(
          `bet ${betId}: refunded ${capped.refund}¢ cap excess to ${capped.userId}`,
        );
      }
    }

    if (!bet.activeUntil) {
      throw new Error(`bet ${betId} has no activeUntil — cannot advance to ACTIVE`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bet.update({
        where: { id: betId },
        data: { status: BetStatus.ACTIVE },
      });
      await this.scheduler.schedule(JobType.BET_EXPIRE, bet.activeUntil!, { betId }, tx);
    });

    this.logger.log(`bet ${betId}: STAKING → ACTIVE (expires ${bet.activeUntil.toISOString()})`);
    this.realtime.emitToBet(betId, "bet:odds_locked", { betId, circleId: bet.circleId });
  }
}
