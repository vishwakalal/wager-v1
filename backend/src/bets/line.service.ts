import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Bet, BetStatus, JobType, MemberStatus, Prisma } from "@prisma/client";
import { trimmedMeanLine, LINE_CHALLENGE_THRESHOLD, LINE_CHALLENGE_WINDOW_MS } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";

@Injectable()
export class LineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  /**
   * Submit a blind line value for the current round (spec §3.1).
   * Values are hidden from everyone until the line is revealed.
   * Auto-reveals once every eligible member has submitted.
   */
  async submitValue(betId: string, userId: string, value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException("value must be a non-negative number");
    }

    const bet = await this.getBetOrThrow(betId);
    if (bet.status !== BetStatus.LINE_SETTING) {
      throw new BadRequestException("line submissions are not open for this bet");
    }
    if (bet.type !== "NUMERIC") {
      throw new BadRequestException("binary bets do not have a line");
    }

    await this.requireEligible(bet, userId);

    const existing = await this.prisma.lineSubmission.findUnique({
      where: { betId_userId_round: { betId, userId, round: bet.lineRound } },
    });
    if (existing) throw new ConflictException("you have already submitted a line for this round");

    await this.prisma.lineSubmission.create({
      data: { betId, userId, value: new Prisma.Decimal(value), round: bet.lineRound },
    });

    // Auto-reveal if every eligible member has now submitted
    await this.maybeAutoReveal(bet);

    return { submitted: true };
  }

  /**
   * Creator manually reveals the line (spec §3.1).
   * Useful when not all members have submitted but the creator wants to proceed.
   */
  async reveal(betId: string, actorId: string) {
    const bet = await this.getBetOrThrow(betId);
    if (bet.status !== BetStatus.LINE_SETTING) {
      throw new BadRequestException("bet is not in the line-setting phase");
    }
    if (bet.creatorId !== actorId) {
      throw new ForbiddenException("only the bet creator can reveal the line");
    }

    const count = await this.prisma.lineSubmission.count({
      where: { betId, round: bet.lineRound },
    });
    if (count === 0) {
      throw new BadRequestException("no submissions yet — at least one is required to reveal");
    }

    return this.doReveal(bet);
  }

  /**
   * Cast a dispute vote against the revealed line (spec §3.1).
   * If ≥50% of eligible members dispute, the round resets and everyone resubmits.
   */
  async disputeRevealedLine(betId: string, userId: string) {
    const bet = await this.getBetOrThrow(betId);
    if (bet.status !== BetStatus.LINE_CHALLENGE) {
      throw new BadRequestException("bet is not in the line-challenge phase");
    }

    await this.requireEligible(bet, userId);

    const existing = await this.prisma.lineDisputeVote.findUnique({
      where: { betId_userId_round: { betId, userId, round: bet.lineRound } },
    });
    if (existing) throw new ConflictException("you have already voted on this challenge");

    await this.prisma.lineDisputeVote.create({
      data: { betId, userId, round: bet.lineRound },
    });

    const [eligibleCount, disputeCount] = await Promise.all([
      this.eligibleMemberCount(bet),
      this.prisma.lineDisputeVote.count({ where: { betId, round: bet.lineRound } }),
    ]);

    const threshold50pct = disputeCount / eligibleCount >= LINE_CHALLENGE_THRESHOLD;

    if (threshold50pct) {
      // Reset: new round, back to blind submission (spec §3.1)
      await this.prisma.$transaction(async (db) => {
        await db.bet.update({
          where: { id: betId },
          data: {
            status: BetStatus.LINE_SETTING,
            lineRound: bet.lineRound + 1,
            line: null,
            lineRevealedAt: null,
            challengeEndsAt: null,
          },
        });
        // Cancel the pending LINE_CHALLENGE_EXPIRE job for this round
        await this.scheduler.cancelForBet(JobType.LINE_CHALLENGE_EXPIRE, betId, db);
      });
      return { disputed: true, redoing: true };
    }

    return { disputed: true, redoing: false };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async maybeAutoReveal(bet: Bet): Promise<void> {
    const [eligibleCount, submissionCount] = await Promise.all([
      this.eligibleMemberCount(bet),
      this.prisma.lineSubmission.count({ where: { betId: bet.id, round: bet.lineRound } }),
    ]);
    if (submissionCount >= eligibleCount) {
      await this.doReveal(bet);
    }
  }

  private async doReveal(bet: Bet) {
    const submissions = await this.prisma.lineSubmission.findMany({
      where: { betId: bet.id, round: bet.lineRound },
      select: { value: true },
    });

    const values = submissions.map((s) => s.value.toNumber());
    const { line } = trimmedMeanLine(values);

    const now = new Date();
    const challengeEndsAt = new Date(now.getTime() + LINE_CHALLENGE_WINDOW_MS);

    return this.prisma.$transaction(async (db) => {
      const updated = await db.bet.update({
        where: { id: bet.id },
        data: {
          line: new Prisma.Decimal(line),
          lineRevealedAt: now,
          challengeEndsAt,
          status: BetStatus.LINE_CHALLENGE,
        },
      });
      await this.scheduler.schedule(
        JobType.LINE_CHALLENGE_EXPIRE,
        challengeEndsAt,
        { betId: bet.id },
        db,
      );
      return updated;
    });
  }

  private async requireEligible(bet: Bet, userId: string): Promise<void> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId: bet.circleId, userId } },
    });
    // Must be approved AND joined before the bet was created (spec §2.1)
    const eligible =
      m &&
      m.status === MemberStatus.APPROVED &&
      m.joinedAt !== null &&
      m.joinedAt <= bet.createdAt;

    if (!eligible) throw new ForbiddenException("you are not eligible to participate in this bet");
  }

  private eligibleMemberCount(bet: Bet): Promise<number> {
    return this.prisma.circleMembership.count({
      where: {
        circleId: bet.circleId,
        status: MemberStatus.APPROVED,
        joinedAt: { lte: bet.createdAt },
      },
    });
  }

  private async getBetOrThrow(betId: string): Promise<Bet> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    return bet;
  }
}
