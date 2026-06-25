import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BetDuration, BetStatus, JobStatus, JobType, Prisma } from "@prisma/client";
import { STAKING_WINDOW_MS, BET_ACTIVE_MS, STAKING_CLOSING_WARNING_MS } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";

type JobPayload = Record<string, string>;
type JobHandler = (payload: JobPayload) => Promise<void>;

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
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly handlers = new Map<JobType, JobHandler>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.poll().catch((err) => this.logger.error("scheduler poll error", err));
    }, 10_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Domain services call this in their onModuleInit to register handlers for the
   * job types they own. Keeps SchedulerModule dependency-free of domain modules.
   */
  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /** Schedule a new job. Pass a tx client to enqueue inside an existing transaction. */
  async schedule(
    type: JobType,
    runAt: Date,
    payload: JobPayload,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.scheduledJob.create({ data: { type, runAt, payload, status: JobStatus.PENDING } });
  }

  /** Cancel PENDING jobs of a given type for a bet (e.g. on line dispute reset). */
  async cancelForBet(type: JobType, betId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.$executeRaw`
      UPDATE scheduled_jobs
         SET status = 'CANCELLED', "updatedAt" = NOW()
       WHERE type = ${type}::"JobType"
         AND status = 'PENDING'
         AND payload->>'betId' = ${betId}
    `;
  }

  // ─── Polling loop ──────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const now = new Date();

    const jobs = await this.prisma.scheduledJob.findMany({
      where: { status: JobStatus.PENDING, runAt: { lte: now } },
      orderBy: { runAt: "asc" },
      take: 20,
    });

    for (const job of jobs) {
      const { count } = await this.prisma.scheduledJob.updateMany({
        where: { id: job.id, status: JobStatus.PENDING },
        data: { status: JobStatus.RUNNING },
      });
      if (count === 0) continue; // another process won the race

      try {
        await this.dispatch(job.type, job.payload as JobPayload);
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: JobStatus.DONE },
        });
      } catch (err) {
        this.logger.error(`job ${job.id} (${job.type}) failed`, err);
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: JobStatus.FAILED, error: String(err) },
        });
      }
    }
  }

  private async dispatch(type: JobType, payload: JobPayload): Promise<void> {
    const handler = this.handlers.get(type);
    if (handler) {
      await handler(payload);
      return;
    }

    // Built-in handlers that don't depend on domain services
    if (type === JobType.LINE_CHALLENGE_EXPIRE) {
      await this.processLineChallengeExpire(payload["betId"] as string);
      return;
    }

    this.logger.log(`${type} — no handler registered yet (future phase)`);
  }

  // ─── Built-in handler: LINE_CHALLENGE_EXPIRE ───────────────────────────────

  /** 30-min challenge window expired with no 50%+ dispute → open staking (spec §3.1). */
  private async processLineChallengeExpire(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet || bet.status !== BetStatus.LINE_CHALLENGE) return; // idempotent

    const now = new Date();
    const stakingEndsAt = new Date(now.getTime() + stakingWindowMs(bet.duration));
    const activeUntil   = new Date(stakingEndsAt.getTime() + betActiveMs(bet.duration));

    const warningAt = new Date(stakingEndsAt.getTime() - STAKING_CLOSING_WARNING_MS);

    await this.prisma.$transaction(async (db) => {
      await db.bet.update({
        where: { id: betId },
        data: { status: BetStatus.STAKING, stakingEndsAt, activeUntil },
      });
      await this.schedule(JobType.STAKING_CLOSE, stakingEndsAt, { betId }, db);
      if (warningAt > now) {
        await this.schedule(JobType.STAKING_WARNING, warningAt, { betId }, db);
      }
    });

    this.logger.log(`bet ${betId}: LINE_CHALLENGE → STAKING (closes ${stakingEndsAt.toISOString()})`);
  }
}
