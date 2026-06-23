import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BetDuration, BetStatus, JobStatus, JobType, Prisma } from "@prisma/client";
import { STAKING_WINDOW_MS, BET_ACTIVE_MS } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";

type JobPayload = { betId: string };

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

  /** Schedule a new job. Accepts an optional Prisma tx client so callers can
   *  enqueue the job inside the same transaction that changes bet status. */
  async schedule(
    type: JobType,
    runAt: Date,
    payload: JobPayload,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    await db.scheduledJob.create({ data: { type, runAt, payload, status: JobStatus.PENDING } });
  }

  /** Cancel PENDING jobs of a given type for a bet (e.g. when a line is re-set). */
  async cancelForBet(type: JobType, betId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    // payload is JSONB; filter via raw path operator so no full-table scan.
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
      // Soft optimistic-lock: only proceed if this poll "wins" the PENDING → RUNNING race.
      const { count } = await this.prisma.scheduledJob.updateMany({
        where: { id: job.id, status: JobStatus.PENDING },
        data: { status: JobStatus.RUNNING },
      });
      if (count === 0) continue;

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
    switch (type) {
      case JobType.LINE_CHALLENGE_EXPIRE:
        return this.processLineChallengeExpire(payload.betId);
      case JobType.STAKING_CLOSE:
        return this.processStakingClose(payload.betId);
      case JobType.STAKING_WARNING:
      case JobType.BET_EXPIRE:
      case JobType.DISPUTE_CLOSE:
      case JobType.DISPUTE_WARNING:
        this.logger.log(`${type} placeholder — Phase 5/7/10 will handle this`);
        return;
    }
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  /** LINE_CHALLENGE window expired with no 50%+ dispute → open staking (spec §3.1). */
  private async processLineChallengeExpire(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet || bet.status !== BetStatus.LINE_CHALLENGE) return; // idempotent

    const now = new Date();
    const stakingEndsAt = new Date(now.getTime() + stakingWindowMs(bet.duration));
    const activeUntil = new Date(stakingEndsAt.getTime() + betActiveMs(bet.duration));

    await this.prisma.$transaction(async (db) => {
      await db.bet.update({
        where: { id: betId },
        data: { status: BetStatus.STAKING, stakingEndsAt, activeUntil },
      });
      await this.schedule(JobType.STAKING_CLOSE, stakingEndsAt, { betId }, db);
    });

    this.logger.log(`bet ${betId}: LINE_CHALLENGE → STAKING (closes ${stakingEndsAt.toISOString()})`);
  }

  /** Staking window closed — Phase 5 will handle cap/void/odds. Placeholder. */
  private async processStakingClose(betId: string): Promise<void> {
    this.logger.log(`bet ${betId}: STAKING_CLOSE fired — Phase 5 will process this`);
  }
}
