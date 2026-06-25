import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { BetStatus, MemberStatus, type Stake } from "@prisma/client";
import { CANCEL_VOTE_THRESHOLD } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EscrowService } from "../money/escrow.service";
import { RealtimeService } from "../realtime/realtime.service";

const TERMINAL = new Set<BetStatus>([BetStatus.RESOLVED, BetStatus.VOIDED, BetStatus.CANCELLED]);

@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Creator unilateral cancel ─────────────────────────────────────────────

  /**
   * Creator cancels the bet at any lifecycle point (spec §8).
   * Immediately refunds all stakers and marks the bet CANCELLED.
   */
  async cancelByCreator(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    if (bet.creatorId !== userId) throw new ForbiddenException("only the creator can cancel this bet");
    if (TERMINAL.has(bet.status)) {
      throw new BadRequestException("this bet has already ended and cannot be cancelled");
    }

    const stakes = await this.prisma.stake.findMany({ where: { betId } });
    await this.doCancelBet(betId, stakes, "creator");
    return { cancelled: true };
  }

  // ─── Member cancel vote ────────────────────────────────────────────────────

  /**
   * Staker casts a vote to cancel (spec §8). One vote per staker; immutable.
   * When 50%+ of stakers have voted, the bet is cancelled immediately.
   */
  async voteToCancelBet(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    if (TERMINAL.has(bet.status)) {
      throw new BadRequestException("this bet has already ended");
    }

    const [stake, membership] = await Promise.all([
      this.prisma.stake.findUnique({ where: { betId_userId: { betId, userId } } }),
      this.prisma.circleMembership.findUnique({
        where: { circleId_userId: { circleId: bet.circleId, userId } },
      }),
    ]);
    if (!stake) throw new ForbiddenException("only staked members can vote to cancel");
    if (!membership || membership.joinedAt === null || membership.joinedAt > bet.createdAt) {
      throw new ForbiddenException("members who joined after the bet started cannot participate");
    }

    const existing = await this.prisma.cancellationVote.findUnique({
      where: { betId_userId: { betId, userId } },
    });
    if (existing) throw new ConflictException("you have already voted to cancel this bet");

    await this.prisma.cancellationVote.create({ data: { betId, userId } });

    return this.checkCancelThreshold(betId);
  }

  // ─── List votes ────────────────────────────────────────────────────────────

  /** List all cancellation votes for a bet (any circle member can view). */
  async listCancelVotes(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    await this.requireMember(bet.circleId, userId);

    const [votes, stakerCount] = await Promise.all([
      this.prisma.cancellationVote.findMany({
        where: { betId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.stake.count({ where: { betId } }),
    ]);

    const myVote = votes.find((v) => v.userId === userId) ?? null;

    return {
      votes,
      _meta: {
        voteCount: votes.length,
        stakerCount,
        threshold: CANCEL_VOTE_THRESHOLD,
        myVote: myVote !== null,
      },
    };
  }

  // ─── Threshold check ───────────────────────────────────────────────────────

  private async checkCancelThreshold(betId: string) {
    const [stakerCount, voteCount] = await Promise.all([
      this.prisma.stake.count({ where: { betId } }),
      this.prisma.cancellationVote.count({ where: { betId } }),
    ]);

    if (stakerCount > 0 && voteCount / stakerCount >= CANCEL_VOTE_THRESHOLD) {
      // Re-fetch to guard against a concurrent cancel that already finished
      const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
      if (!bet || TERMINAL.has(bet.status)) return { outcome: "pending" as const };

      const stakes = await this.prisma.stake.findMany({ where: { betId } });
      await this.doCancelBet(betId, stakes, "member-vote");
      return { outcome: "cancelled" as const };
    }

    return { outcome: "pending" as const };
  }

  // ─── Core cancel ──────────────────────────────────────────────────────────

  private async doCancelBet(betId: string, stakes: Stake[], reason: string): Promise<void> {
    for (const s of stakes) {
      const effective = s.effectiveAmount ?? s.amount;
      await this.escrow.release(s.userId, effective, `cancel:refund:${betId}:${s.id}`);
    }
    await this.prisma.bet.update({
      where: { id: betId },
      data: { status: BetStatus.CANCELLED, resolvedAt: new Date() },
    });
    this.logger.log(`bet ${betId}: CANCELLED (${reason}), refunded ${stakes.length} staker(s)`);
    this.realtime.emitToBet(betId, "bet:status_changed", { betId, status: "CANCELLED" });
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  private async requireMember(circleId: string, userId: string): Promise<void> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (!m || m.status !== MemberStatus.APPROVED) {
      throw new ForbiddenException("you are not a member of this circle");
    }
  }
}
