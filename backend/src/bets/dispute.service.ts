import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BetStatus,
  DisputeStatus,
  DisputeType,
  MemberStatus,
  VerificationStatus,
} from "@prisma/client";
import { DISPUTE_THRESHOLD } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DisputeService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Raise a dispute ───────────────────────────────────────────────────────

  /**
   * Raise a dispute during the 24-h window (spec §7.2).
   * ADD: flag a missed event; REMOVE: challenge an already-verified event.
   * Only staked members who joined before the bet started can dispute.
   */
  async raiseDispute(
    betId: string,
    userId: string,
    typeInput: string,
    description: string,
    targetEventId?: string,
  ) {
    if (!description?.trim()) throw new BadRequestException("description is required");

    const type = this.parseType(typeInput);

    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    if (bet.status !== BetStatus.CLOSED) {
      throw new BadRequestException("disputes can only be raised during the 24-h post-expiration window");
    }

    await this.requireStaker(bet.id, bet.circleId, userId, bet.createdAt);

    if (type === DisputeType.REMOVE) {
      if (!targetEventId) throw new BadRequestException("targetEventId is required for REMOVE disputes");
      const target = await this.prisma.verificationEvent.findUnique({ where: { id: targetEventId } });
      if (!target || target.betId !== betId) {
        throw new NotFoundException("target verification event not found on this bet");
      }
      if (target.status !== VerificationStatus.VERIFIED) {
        throw new BadRequestException("can only dispute VERIFIED events");
      }
    }

    return this.prisma.dispute.create({
      data: {
        betId,
        initiatorId: userId,
        type,
        targetEventId: type === DisputeType.REMOVE ? targetEventId : null,
        description: description.trim(),
      },
    });
  }

  // ─── Vote on a dispute ─────────────────────────────────────────────────────

  /**
   * Cast a vote on a dispute (spec §7.2). One vote per staker; immutable once cast.
   * If 70%+ of stakers vote in favor, the dispute is CONFIRMED immediately and the
   * event is added or removed.
   */
  async castVote(disputeId: string, userId: string, inFavor: boolean) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { bet: true },
    });
    if (!dispute) throw new NotFoundException("dispute not found");
    if (dispute.status !== DisputeStatus.PENDING) {
      throw new BadRequestException("this dispute has already been resolved");
    }
    if (dispute.bet.status !== BetStatus.CLOSED) {
      throw new BadRequestException("this bet is no longer in the dispute window");
    }

    await this.requireStaker(dispute.betId, dispute.bet.circleId, userId, dispute.bet.createdAt);

    const existing = await this.prisma.disputeVote.findUnique({
      where: { disputeId_userId: { disputeId, userId } },
    });
    if (existing) throw new ConflictException("you have already voted on this dispute");

    await this.prisma.disputeVote.create({ data: { disputeId, userId, inFavor } });

    return this.checkDisputeThreshold(dispute.id, dispute.betId, dispute.type, dispute.targetEventId);
  }

  // ─── List disputes ────────────────────────────────────────────────────────

  /** List all disputes for a bet with vote counts and the caller's vote. */
  async listDisputes(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    await this.requireMember(bet.circleId, userId);

    const disputes = await this.prisma.dispute.findMany({
      where: { betId },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(
      disputes.map(async (d) => {
        const [inFavorCount, againstCount, myVote] = await Promise.all([
          this.prisma.disputeVote.count({ where: { disputeId: d.id, inFavor: true } }),
          this.prisma.disputeVote.count({ where: { disputeId: d.id, inFavor: false } }),
          this.prisma.disputeVote.findUnique({
            where: { disputeId_userId: { disputeId: d.id, userId } },
            select: { inFavor: true },
          }),
        ]);
        return {
          ...d,
          _meta: { inFavorCount, againstCount, myVote: myVote?.inFavor ?? null },
        };
      }),
    );
  }

  // ─── Threshold check ───────────────────────────────────────────────────────

  private async checkDisputeThreshold(
    disputeId: string,
    betId: string,
    type: DisputeType,
    targetEventId: string | null,
  ) {
    const [stakerCount, inFavorCount] = await Promise.all([
      this.prisma.stake.count({ where: { betId } }),
      this.prisma.disputeVote.count({ where: { disputeId, inFavor: true } }),
    ]);

    if (stakerCount === 0) return { outcome: "pending" as const };

    if (inFavorCount / stakerCount >= DISPUTE_THRESHOLD) {
      await this.confirmDispute(disputeId, type, betId, targetEventId);
      return { outcome: "confirmed" as const };
    }

    return { outcome: "pending" as const };
  }

  /**
   * CONFIRMED: apply the dispute's effect immediately so it's reflected by
   * resolution time (DISPUTE_CLOSE handler reads current VerificationEvent statuses).
   */
  private async confirmDispute(
    disputeId: string,
    type: DisputeType,
    betId: string,
    targetEventId: string | null,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: DisputeStatus.CONFIRMED },
      });

      if (type === DisputeType.ADD) {
        // Create a new VerificationEvent pre-marked as VERIFIED
        await tx.verificationEvent.create({
          data: {
            betId,
            submitterId: await this.getDisputeInitiator(disputeId, tx),
            description: `[Dispute ADD confirmed — dispute id: ${disputeId}]`,
            status: VerificationStatus.VERIFIED,
          },
        });
      } else if (type === DisputeType.REMOVE && targetEventId) {
        // Mark the challenged event as DENIED
        await tx.verificationEvent.update({
          where: { id: targetEventId },
          data: { status: VerificationStatus.DENIED },
        });
      }
    });
  }

  private async getDisputeInitiator(
    disputeId: string,
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
  ): Promise<string> {
    const d = await tx.dispute.findUnique({ where: { id: disputeId }, select: { initiatorId: true } });
    return d!.initiatorId;
  }

  // ─── Guards ────────────────────────────────────────────────────────────────

  private async requireStaker(
    betId: string,
    circleId: string,
    userId: string,
    betCreatedAt: Date,
  ): Promise<void> {
    const [stake, membership] = await Promise.all([
      this.prisma.stake.findUnique({ where: { betId_userId: { betId, userId } } }),
      this.prisma.circleMembership.findUnique({
        where: { circleId_userId: { circleId, userId } },
      }),
    ]);
    if (!stake) {
      throw new ForbiddenException("only staked members can raise or vote on disputes");
    }
    if (!membership || membership.joinedAt === null || membership.joinedAt > betCreatedAt) {
      throw new ForbiddenException("members who joined after the bet started cannot participate");
    }
  }

  private async requireMember(circleId: string, userId: string): Promise<void> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (!m || m.status !== MemberStatus.APPROVED) {
      throw new ForbiddenException("you are not a member of this circle");
    }
  }

  private parseType(input: string): DisputeType {
    const upper = input?.toUpperCase();
    if (upper === "ADD") return DisputeType.ADD;
    if (upper === "REMOVE") return DisputeType.REMOVE;
    throw new BadRequestException('type must be "add" or "remove"');
  }
}
