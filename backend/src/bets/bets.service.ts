import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BetDuration, BetStatus, BetType, JobType, MemberStatus, NotificationTrigger } from "@prisma/client";
import { BET_DURATIONS, MIN_MEMBERS, STAKING_WINDOW_MS, BET_ACTIVE_MS, STAKING_CLOSING_WARNING_MS } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { RealtimeService } from "../realtime/realtime.service";
import { NotificationService } from "../notifications/notification.service";

export interface CreateBetDto {
  type: string;
  duration: string;
  description: string;
}

const DURATION_INPUT_MAP: Record<string, BetDuration> = {
  "1_day":   BetDuration.ONE_DAY,
  "1_week":  BetDuration.ONE_WEEK,
  "1_month": BetDuration.ONE_MONTH,
};

function stakingWindowMs(duration: BetDuration): number {
  switch (duration) {
    case BetDuration.ONE_DAY:   return STAKING_WINDOW_MS["1_day"];
    case BetDuration.ONE_WEEK:  return STAKING_WINDOW_MS["1_week"];
    case BetDuration.ONE_MONTH: return STAKING_WINDOW_MS["1_month"];
  }
}

function betActiveMs(duration: BetDuration): number {
  switch (duration) {
    case BetDuration.ONE_DAY:   return BET_ACTIVE_MS["1_day"];
    case BetDuration.ONE_WEEK:  return BET_ACTIVE_MS["1_week"];
    case BetDuration.ONE_MONTH: return BET_ACTIVE_MS["1_month"];
  }
}

@Injectable()
export class BetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationService,
  ) {}

  async create(circleId: string, creatorId: string, dto: CreateBetDto) {
    // Validate type
    if (dto.type !== "NUMERIC" && dto.type !== "BINARY") {
      throw new BadRequestException('type must be "NUMERIC" or "BINARY"');
    }
    const betType = dto.type as BetType;

    // Validate duration
    const durationInput = dto.duration as (typeof BET_DURATIONS)[number];
    if (!BET_DURATIONS.includes(durationInput)) {
      throw new BadRequestException('duration must be "1_day", "1_week", or "1_month"');
    }
    const duration = DURATION_INPUT_MAP[durationInput]!;

    if (!dto.description?.trim()) {
      throw new BadRequestException("description is required");
    }

    // Verify creator is an approved member
    const membership = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId: creatorId } },
    });
    if (!membership || membership.status !== MemberStatus.APPROVED) {
      throw new ForbiddenException("you must be a circle member to create a bet");
    }

    // Enforce minimum member counts (spec §2.2)
    const memberCount = await this.prisma.circleMembership.count({
      where: { circleId, status: MemberStatus.APPROVED },
    });
    const minRequired = MIN_MEMBERS[betType === BetType.NUMERIC ? "numeric" : "binary"];
    if (memberCount < minRequired) {
      throw new BadRequestException(
        `${betType.toLowerCase()} bets require at least ${minRequired} circle members (circle has ${memberCount})`,
      );
    }

    const now = new Date();

    if (betType === BetType.BINARY) {
      // Binary bets skip line setting — open staking immediately (spec §2.2)
      const stakingEndsAt = new Date(now.getTime() + stakingWindowMs(duration));
      const activeUntil  = new Date(stakingEndsAt.getTime() + betActiveMs(duration));

      const bet = await this.prisma.$transaction(async (db) => {
        const created = await db.bet.create({
          data: {
            circleId,
            creatorId,
            type: BetType.BINARY,
            duration,
            status: BetStatus.STAKING,
            description: dto.description.trim(),
            stakingEndsAt,
            activeUntil,
          },
        });
        await this.scheduler.schedule(JobType.STAKING_CLOSE, stakingEndsAt, { betId: created.id }, db);
        const warningAt = new Date(stakingEndsAt.getTime() - STAKING_CLOSING_WARNING_MS);
        if (warningAt > now) {
          await this.scheduler.schedule(JobType.STAKING_WARNING, warningAt, { betId: created.id }, db);
        }
        return created;
      });
      this.realtime.emitToCircle(circleId, "bet:created", { betId: bet.id, type: bet.type });
      void this.notifyCircleBetCreated(circleId, creatorId, bet.id, bet.description);
      return bet;
    }

    // Numeric — start in LINE_SETTING; no timer until line is revealed
    const bet = await this.prisma.bet.create({
      data: {
        circleId,
        creatorId,
        type: BetType.NUMERIC,
        duration,
        status: BetStatus.LINE_SETTING,
        description: dto.description.trim(),
        lineRound: 1,
      },
    });
    this.realtime.emitToCircle(circleId, "bet:created", { betId: bet.id, type: bet.type });
    void this.notifyCircleBetCreated(circleId, creatorId, bet.id, bet.description);
    return bet;
  }

  private async notifyCircleBetCreated(
    circleId: string,
    creatorId: string,
    betId: string,
    description: string,
  ): Promise<void> {
    const memberships = await this.prisma.circleMembership.findMany({
      where: { circleId, status: MemberStatus.APPROVED, userId: { not: creatorId } },
      select: { userId: true },
    });
    const userIds = memberships.map((m) => m.userId);
    await this.notifications.send(userIds, NotificationTrigger.CIRCLE_BET_CREATED, {
      title: "New bet in your circle",
      body: description,
      data: { betId },
    });
  }

  /** List all bets in a circle. Caller must be an approved member. */
  async listByCircle(circleId: string, userId: string) {
    await this.requireMember(circleId, userId);

    return this.prisma.bet.findMany({
      where: { circleId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Get a single bet with submission/dispute counts for the current round. */
  async getById(betId: string, userId: string) {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) throw new NotFoundException("bet not found");

    await this.requireMember(bet.circleId, userId);

    const [submissionCount, disputeCount, eligibleCount, userSubmitted, userDisputed] =
      await Promise.all([
        this.prisma.lineSubmission.count({ where: { betId, round: bet.lineRound } }),
        this.prisma.lineDisputeVote.count({ where: { betId, round: bet.lineRound } }),
        this.prisma.circleMembership.count({
          where: { circleId: bet.circleId, status: MemberStatus.APPROVED, joinedAt: { lte: bet.createdAt } },
        }),
        this.prisma.lineSubmission.findUnique({
          where: { betId_userId_round: { betId, userId, round: bet.lineRound } },
          select: { id: true },
        }),
        this.prisma.lineDisputeVote.findUnique({
          where: { betId_userId_round: { betId, userId, round: bet.lineRound } },
          select: { id: true },
        }),
      ]);

    return {
      ...bet,
      // Line values are hidden until revealed; line field is null in LINE_SETTING
      _meta: {
        submissionCount,
        disputeCount,
        eligibleCount,
        userHasSubmitted: !!userSubmitted,
        userHasDisputed: !!userDisputed,
      },
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
}
