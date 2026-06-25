import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { JobType, NotificationTrigger } from "@prisma/client";
import { STAKING_CLOSING_WARNING_MS, DISPUTE_CLOSING_WARNING_MS } from "@wager/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulerService } from "../scheduler/scheduler.service";
import { NOTIFICATION_DEFAULTS } from "./notification-defaults";
import { sendExpoPushMessages } from "./expo-push.client";

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit() {
    this.scheduler.registerHandler(JobType.STAKING_WARNING, (p) =>
      this.handleStakingWarning(p["betId"] as string),
    );
    this.scheduler.registerHandler(JobType.DISPUTE_WARNING, (p) =>
      this.handleDisputeWarning(p["betId"] as string),
    );
  }

  // ─── Token management ─────────────────────────────────────────────────────

  async registerToken(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removeToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } });
  }

  // ─── Core send ────────────────────────────────────────────────────────────

  /**
   * Send a push notification to one or more users (respects per-trigger preferences).
   * Fire-and-forget safe: logs errors, never throws.
   */
  async send(
    userIds: string | string[],
    trigger: NotificationTrigger,
    msg: NotificationPayload,
  ): Promise<void> {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    if (ids.length === 0) return;

    try {
      // Check preferences — sparse table, missing row means use default
      const prefs = await this.prisma.notificationPreference.findMany({
        where: { userId: { in: ids }, trigger },
        select: { userId: true, enabled: true },
      });
      const prefMap = new Map(prefs.map((p) => [p.userId, p.enabled]));
      const defaultEnabled = NOTIFICATION_DEFAULTS[trigger];

      const enabledIds = ids.filter((id) => prefMap.get(id) ?? defaultEnabled);
      if (enabledIds.length === 0) return;

      // Fetch push tokens for enabled users
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId: { in: enabledIds } },
        select: { token: true },
      });
      if (tokens.length === 0) return;

      await sendExpoPushMessages(
        tokens.map((t) => ({
          to: t.token,
          title: msg.title,
          body: msg.body,
          data: msg.data,
          sound: "default" as const,
        })),
      );
    } catch (err) {
      this.logger.error(`send(${trigger}) error`, err);
    }
  }

  // ─── Scheduler-driven handlers ────────────────────────────────────────────

  private async handleStakingWarning(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) return;

    // Notify eligible members (anyone who could still stake)
    const memberships = await this.prisma.circleMembership.findMany({
      where: {
        circleId: bet.circleId,
        status: "APPROVED",
        joinedAt: { lte: bet.createdAt },
      },
      select: { userId: true },
    });
    const userIds = memberships.map((m) => m.userId);

    await this.send(userIds, NotificationTrigger.BET_STAKING_WARNING, {
      title: "Staking closes in 30 minutes",
      body: `Place your stake on "${bet.description}" before the window closes.`,
      data: { betId },
    });
  }

  private async handleDisputeWarning(betId: string): Promise<void> {
    const bet = await this.prisma.bet.findUnique({ where: { id: betId } });
    if (!bet) return;

    const stakes = await this.prisma.stake.findMany({
      where: { betId },
      select: { userId: true },
    });
    const userIds = stakes.map((s) => s.userId);

    await this.send(userIds, NotificationTrigger.BET_DISPUTE_WARNING, {
      title: "Dispute window closing in 2 hours",
      body: `Final chance to raise or vote on disputes for "${bet.description}".`,
      data: { betId },
    });
  }

  // ─── Preference utilities (used by NotificationController) ───────────────

  async getPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const storedMap = new Map(stored.map((p) => [p.trigger, p.enabled]));

    return (Object.keys(NOTIFICATION_DEFAULTS) as NotificationTrigger[]).map((trigger) => ({
      trigger,
      enabled: storedMap.get(trigger) ?? NOTIFICATION_DEFAULTS[trigger],
    }));
  }

  async updatePreferences(
    userId: string,
    updates: Array<{ trigger: string; enabled: boolean }>,
  ): Promise<void> {
    for (const u of updates) {
      const trigger = u.trigger as NotificationTrigger;
      if (!(trigger in NOTIFICATION_DEFAULTS)) continue; // skip unknown triggers

      await this.prisma.notificationPreference.upsert({
        where: { userId_trigger: { userId, trigger } },
        create: { userId, trigger, enabled: u.enabled },
        update: { enabled: u.enabled },
      });
    }
  }

  // ─── Exposed for SchedulerService to schedule warning jobs ───────────────

  /** Call this whenever a staking window opens to schedule the 30-min warning. */
  static stakingWarningAt(stakingEndsAt: Date): Date {
    return new Date(stakingEndsAt.getTime() - STAKING_CLOSING_WARNING_MS);
  }

  /** Call this when the dispute window opens to schedule the 2-h warning. */
  static disputeWarningAt(disputeCloseAt: Date): Date {
    return new Date(disputeCloseAt.getTime() - DISPUTE_CLOSING_WARNING_MS);
  }
}
