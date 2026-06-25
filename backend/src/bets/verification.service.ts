import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import {
  type Bet,
  BetStatus,
  JobType,
  MemberStatus,
  NotificationTrigger,
  Prisma,
  type VerificationEvent,
  VerificationStatus,
  VoteChoice,
} from "@prisma/client";
import { VERIFY_THRESHOLD, TIEBREAKER_REVOTE_WINDOW_MS } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { RealtimeService } from "../realtime/realtime.service";
import { NotificationService } from "../notifications/notification.service";

const CHOICE_MAP: Record<string, VoteChoice> = {
  verify: VoteChoice.VERIFY,
  deny:   VoteChoice.DENY,
};

@Injectable()
export class VerificationService implements OnModuleInit {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    this.scheduler.registerHandler(
      JobType.VERIFICATION_TIEBREAKER_EXPIRE,
      (payload) => this.resolveExpiredTiebreaker(payload["verificationEventId"] as string),
    );
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

  /**
   * Queue a new event for verification (spec §6.1).
   * Submitter must be staked and joined before the bet started.
   */
  async submitEvent(
    betId: string,
    userId: string,
    description: string,
    numericValue?: number,
  ) {
    if (!description?.trim()) throw new BadRequestException("description is required");

    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    if (bet.status !== BetStatus.ACTIVE) {
      throw new BadRequestException("events can only be submitted while the bet is active");
    }

    await this.requireStaker(bet, userId);

    const event = await this.prisma.verificationEvent.create({
      data: {
        betId,
        submitterId: userId,
        description: description.trim(),
        ...(numericValue !== undefined
          ? { numericValue: new Prisma.Decimal(numericValue) }
          : {}),
      },
    });

    // Notify all stakers (except submitter) that a new event needs verification
    const stakes = await this.prisma.stake.findMany({
      where: { betId, userId: { not: userId } },
      select: { userId: true },
    });
    void this.notifications.send(
      stakes.map((s) => s.userId),
      NotificationTrigger.VERIFICATION_NEEDED,
      { title: "New event to verify", body: description.trim(), data: { betId, eventId: event.id } },
    );

    return event;
  }

  /** List all events for a bet, with vote counts and the caller's vote status. */
  async listEvents(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");
    await this.requireMember(bet.circleId, userId);

    const events = await this.prisma.verificationEvent.findMany({
      where: { betId },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(
      events.map(async (ev) => {
        const [verifyCount, denyCount, myVote, myTiebreakerVote] = await Promise.all([
          this.prisma.verificationVote.count({
            where: { verificationEventId: ev.id, round: 1, choice: VoteChoice.VERIFY },
          }),
          this.prisma.verificationVote.count({
            where: { verificationEventId: ev.id, round: 1, choice: VoteChoice.DENY },
          }),
          this.prisma.verificationVote.findUnique({
            where: { verificationEventId_userId_round: { verificationEventId: ev.id, userId, round: 1 } },
            select: { choice: true },
          }),
          this.prisma.verificationVote.findUnique({
            where: { verificationEventId_userId_round: { verificationEventId: ev.id, userId, round: 2 } },
            select: { choice: true },
          }),
        ]);

        return {
          ...ev,
          _meta: {
            verifyCount,
            denyCount,
            myVote: myVote?.choice ?? null,
            myTiebreakerVote: myTiebreakerVote?.choice ?? null,
          },
        };
      }),
    );
  }

  // ─── Voting ────────────────────────────────────────────────────────────────

  /**
   * Cast an initial vote on a PENDING_VOTE event (spec §6.1).
   * Immutable once cast — use castTiebreakerVote during TIEBREAKER phase.
   */
  async castVote(eventId: string, userId: string, choiceInput: string) {
    const choice = this.parseChoice(choiceInput);
    const { event, bet } = await this.loadActiveEvent(eventId, VerificationStatus.PENDING_VOTE);

    await this.requireStaker(bet, userId);

    const existing = await this.prisma.verificationVote.findUnique({
      where: { verificationEventId_userId_round: { verificationEventId: eventId, userId, round: 1 } },
    });
    if (existing) throw new ConflictException("you have already voted on this event");

    await this.prisma.verificationVote.create({
      data: { verificationEventId: eventId, userId, choice, round: 1 },
    });

    return this.checkVoteThreshold(event, bet);
  }

  /**
   * Cast or change a vote during the TIEBREAKER window (spec §6.2).
   * Members may change their vote until the window closes.
   */
  async castTiebreakerVote(eventId: string, userId: string, choiceInput: string) {
    const choice = this.parseChoice(choiceInput);
    const { event, bet } = await this.loadActiveEvent(eventId, VerificationStatus.TIEBREAKER);

    if (event.tiebreakerEndsAt && event.tiebreakerEndsAt < new Date()) {
      throw new BadRequestException("tiebreaker window has already closed");
    }

    await this.requireStaker(bet, userId);

    // Upsert: allow changing an existing tiebreaker vote
    await this.prisma.verificationVote.upsert({
      where: { verificationEventId_userId_round: { verificationEventId: eventId, userId, round: 2 } },
      create: { verificationEventId: eventId, userId, choice, round: 2 },
      update: { choice },
    });

    return this.checkTiebreakerThreshold(event, bet);
  }

  // ─── Scheduler handler ─────────────────────────────────────────────────────

  /** Tiebreaker window expired: tie still stands → DENIED by default (spec §6.2). */
  async resolveExpiredTiebreaker(eventId: string): Promise<void> {
    const event = await this.prisma.verificationEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== VerificationStatus.TIEBREAKER) return;

    const bet = await this.prisma.bet.findUnique({ where: { id: event.betId } });
    if (!bet) return;

    const [verifyCount, denyCount] = await Promise.all([
      this.prisma.verificationVote.count({
        where: { verificationEventId: eventId, round: 2, choice: VoteChoice.VERIFY },
      }),
      this.prisma.verificationVote.count({
        where: { verificationEventId: eventId, round: 2, choice: VoteChoice.DENY },
      }),
    ]);

    // Majority wins; tie at expiry → DENIED by default (spec §6.2 step 5)
    const finalStatus =
      verifyCount > denyCount ? VerificationStatus.VERIFIED : VerificationStatus.DENIED;

    await this.prisma.verificationEvent.update({
      where: { id: eventId },
      data: { status: finalStatus },
    });

    this.logger.log(`tiebreaker expired for event ${eventId}: ${finalStatus}`);
  }

  // ─── Threshold logic ───────────────────────────────────────────────────────

  private async checkVoteThreshold(event: VerificationEvent, bet: Bet) {
    const [stakerCount, verifyCount, denyCount] = await Promise.all([
      this.prisma.stake.count({ where: { betId: bet.id } }),
      this.prisma.verificationVote.count({
        where: { verificationEventId: event.id, round: 1, choice: VoteChoice.VERIFY },
      }),
      this.prisma.verificationVote.count({
        where: { verificationEventId: event.id, round: 1, choice: VoteChoice.DENY },
      }),
    ]);

    if (stakerCount === 0) return { outcome: "pending" as const };

    const verifyRatio = verifyCount / stakerCount;
    const denyRatio   = denyCount   / stakerCount;
    const totalVoted  = verifyCount + denyCount;

    if (verifyRatio >= VERIFY_THRESHOLD && denyRatio < VERIFY_THRESHOLD) {
      await this.prisma.verificationEvent.update({
        where: { id: event.id },
        data: { status: VerificationStatus.VERIFIED },
      });
      this.logger.log(`event ${event.id} VERIFIED (${verifyCount}/${stakerCount})`);
      this.realtime.emitToBet(bet.id, "bet:verification_updated", { betId: bet.id, eventId: event.id, status: "VERIFIED" });
      void this.notifyAllStakers(bet.id, NotificationTrigger.VERIFICATION_APPROVED, {
        title: "Event verified",
        body: `An event on "${bet.description}" was verified by the group.`,
        data: { betId: bet.id, eventId: event.id },
      });
      return { outcome: "verified" as const };
    }

    if (denyRatio >= VERIFY_THRESHOLD && verifyRatio < VERIFY_THRESHOLD) {
      await this.prisma.verificationEvent.update({
        where: { id: event.id },
        data: { status: VerificationStatus.DENIED },
      });
      this.logger.log(`event ${event.id} DENIED (${denyCount}/${stakerCount})`);
      this.realtime.emitToBet(bet.id, "bet:verification_updated", { betId: bet.id, eventId: event.id, status: "DENIED" });
      void this.notifyAllStakers(bet.id, NotificationTrigger.VERIFICATION_DENIED, {
        title: "Event denied",
        body: `An event on "${bet.description}" was denied by the group.`,
        data: { betId: bet.id, eventId: event.id },
      });
      return { outcome: "denied" as const };
    }

    // 50/50 tie: all stakers have voted and it's exactly split
    if (totalVoted === stakerCount && verifyCount === denyCount) {
      const tiebreakerEndsAt = new Date(Date.now() + TIEBREAKER_REVOTE_WINDOW_MS);
      await this.prisma.verificationEvent.update({
        where: { id: event.id },
        data: { status: VerificationStatus.TIEBREAKER, tiebreakerEndsAt },
      });
      await this.scheduler.schedule(
        JobType.VERIFICATION_TIEBREAKER_EXPIRE,
        tiebreakerEndsAt,
        { betId: bet.id, verificationEventId: event.id } satisfies Record<string, string>,
      );
      this.logger.log(`event ${event.id} TIEBREAKER (${verifyCount}/${stakerCount} each)`);
      void this.notifyAllStakers(bet.id, NotificationTrigger.VERIFICATION_TIEBREAKER, {
        title: "Verification tiebreaker",
        body: `Vote is tied on "${bet.description}" — re-vote to break the tie.`,
        data: { betId: bet.id, eventId: event.id },
      });
      return { outcome: "tiebreaker" as const, tiebreakerEndsAt };
    }

    return { outcome: "pending" as const };
  }

  private async checkTiebreakerThreshold(event: VerificationEvent, bet: Bet) {
    const [stakerCount, verifyCount, denyCount] = await Promise.all([
      this.prisma.stake.count({ where: { betId: bet.id } }),
      this.prisma.verificationVote.count({
        where: { verificationEventId: event.id, round: 2, choice: VoteChoice.VERIFY },
      }),
      this.prisma.verificationVote.count({
        where: { verificationEventId: event.id, round: 2, choice: VoteChoice.DENY },
      }),
    ]);

    if (stakerCount === 0) return { outcome: "pending" as const };

    const verifyRatio = verifyCount / stakerCount;
    const denyRatio   = denyCount   / stakerCount;

    if (verifyRatio > denyRatio && verifyRatio >= VERIFY_THRESHOLD) {
      await this.prisma.verificationEvent.update({
        where: { id: event.id },
        data: { status: VerificationStatus.VERIFIED },
      });
      return { outcome: "verified" as const };
    }

    if (denyRatio > verifyRatio && denyRatio >= VERIFY_THRESHOLD) {
      await this.prisma.verificationEvent.update({
        where: { id: event.id },
        data: { status: VerificationStatus.DENIED },
      });
      return { outcome: "denied" as const };
    }

    return { outcome: "pending" as const };
  }

  // ─── Notification helper ───────────────────────────────────────────────────

  private async notifyAllStakers(
    betId: string,
    trigger: NotificationTrigger,
    msg: Parameters<NotificationService["send"]>[2],
  ): Promise<void> {
    const stakes = await this.prisma.stake.findMany({ where: { betId }, select: { userId: true } });
    await this.notifications.send(stakes.map((s) => s.userId), trigger, msg);
  }

  // ─── Guards & helpers ──────────────────────────────────────────────────────

  private async loadActiveEvent(eventId: string, expectedStatus: VerificationStatus) {
    const event = await this.prisma.verificationEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException("verification event not found");
    if (event.status !== expectedStatus) {
      const label = expectedStatus === VerificationStatus.PENDING_VOTE
        ? "open for voting"
        : "in a tiebreaker phase";
      throw new BadRequestException(`this event is not currently ${label}`);
    }
    const bet = await this.prisma.bet.findUnique({ where: { id: event.betId } });
    if (!bet || bet.status !== BetStatus.ACTIVE) {
      throw new BadRequestException("the bet is not currently active");
    }
    return { event, bet };
  }

  /** Must be staked on the bet AND joined before the bet started (spec §6.1). */
  private async requireStaker(bet: Bet, userId: string): Promise<void> {
    const [stake, membership] = await Promise.all([
      this.prisma.stake.findUnique({ where: { betId_userId: { betId: bet.id, userId } } }),
      this.prisma.circleMembership.findUnique({
        where: { circleId_userId: { circleId: bet.circleId, userId } },
      }),
    ]);

    if (!stake) {
      throw new ForbiddenException("only staked members can submit or vote on verifications");
    }
    if (!membership || membership.joinedAt === null || membership.joinedAt > bet.createdAt) {
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

  private parseChoice(input: string): VoteChoice {
    const choice = CHOICE_MAP[input?.toLowerCase()];
    if (!choice) throw new BadRequestException('choice must be "verify" or "deny"');
    return choice;
  }
}
