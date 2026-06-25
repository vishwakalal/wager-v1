import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MemberRole, MemberStatus, NotificationTrigger, type Circle, type CircleMembership } from "@prisma/client";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";

const INVITE_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CircleDetail {
  circle: Circle;
  members: (CircleMembership & { user: { id: string; displayName: string | null } })[];
}

@Injectable()
export class CirclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Create a new circle. The creator is immediately an APPROVED CREATOR member. */
  async create(userId: string, name: string): Promise<Circle> {
    return this.prisma.$transaction(async (db) => {
      const circle = await db.circle.create({ data: { name } });
      await db.circleMembership.create({
        data: {
          circleId: circle.id,
          userId,
          role: MemberRole.CREATOR,
          status: MemberStatus.APPROVED,
          joinedAt: new Date(),
        },
      });
      return circle;
    });
  }

  /**
   * Invite a user to a circle. Only the CREATOR can invite.
   * Creates a PENDING membership the creator can then approve.
   */
  async invite(circleId: string, actorId: string, targetUserId: string): Promise<CircleMembership> {
    await this.requireRole(circleId, actorId, MemberRole.CREATOR);

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.deletedAt) throw new NotFoundException("user not found");

    const existing = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId: targetUserId } },
    });
    if (existing) throw new ConflictException("user is already a member or has a pending invite");

    return this.prisma.circleMembership.create({
      data: { circleId, userId: targetUserId, role: MemberRole.MEMBER, status: MemberStatus.PENDING },
    });
  }

  /**
   * Approve a pending member. Only the CREATOR can approve.
   * Sets joinedAt to now — this timestamp is what prevents mid-bet participation (spec §2.1).
   */
  async approve(circleId: string, actorId: string, targetUserId: string): Promise<CircleMembership> {
    await this.requireRole(circleId, actorId, MemberRole.CREATOR);

    const membership = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException("no pending invite for this user");
    if (membership.status === MemberStatus.APPROVED) {
      throw new ConflictException("user is already approved");
    }

    const updated = await this.prisma.circleMembership.update({
      where: { circleId_userId: { circleId, userId: targetUserId } },
      data: { status: MemberStatus.APPROVED, joinedAt: new Date() },
    });

    void this.notifications.send(targetUserId, NotificationTrigger.CIRCLE_APPROVED, {
      title: "Join request approved",
      body: `You've been approved to join the circle.`,
      data: { circleId },
    });

    return updated;
  }

  /**
   * User-initiated join request (found the circle via search). Creates a
   * PENDING membership identical to an invite — the creator must still approve.
   * This is the complement to `invite` (which is creator-initiated).
   */
  async requestToJoin(circleId: string, userId: string): Promise<CircleMembership> {
    const circle = await this.prisma.circle.findUnique({ where: { id: circleId } });
    if (!circle) throw new NotFoundException("circle not found");

    const existing = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (existing) {
      throw new ConflictException(
        existing.status === MemberStatus.APPROVED
          ? "you are already a member of this circle"
          : "you already have a pending request for this circle",
      );
    }

    const membership = await this.prisma.circleMembership.create({
      data: { circleId, userId, role: MemberRole.MEMBER, status: MemberStatus.PENDING },
    });

    // Notify circle creator of the join request
    const creator = await this.prisma.circleMembership.findFirst({
      where: { circleId, role: MemberRole.CREATOR, status: MemberStatus.APPROVED },
      select: { userId: true },
    });
    if (creator) {
      void this.notifications.send(creator.userId, NotificationTrigger.CIRCLE_JOIN_REQUEST, {
        title: "New join request",
        body: `Someone wants to join your circle.`,
        data: { circleId },
      });
    }

    return membership;
  }

  /**
   * Leave a circle, with spec §2.1 guards.
   * - Any member: cannot leave if they have an active stake (Phase 5 wires this up).
   * - Creator: cannot leave if any bet is active (Phase 4 wires this up).
   * - Creator leaving with other members: transfers CREATOR role to longest-standing member.
   * - Creator leaving an empty circle (only themselves): circle is deleted.
   */
  async leave(circleId: string, userId: string): Promise<void> {
    const membership = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (!membership || membership.status !== MemberStatus.APPROVED) {
      throw new NotFoundException("you are not a member of this circle");
    }

    // Guard: active stake (Phase 5 placeholder — always passes for now).
    await this.checkNoActiveStake(circleId, userId);

    if (membership.role === MemberRole.CREATOR) {
      // Guard: active bet (Phase 4 placeholder — always passes for now).
      await this.checkNoActiveBet(circleId);
      await this.leaveAsCreator(circleId, userId);
    } else {
      await this.prisma.circleMembership.delete({
        where: { circleId_userId: { circleId, userId } },
      });
    }
  }

  /** List circles where the user is an APPROVED member. */
  async listMine(userId: string): Promise<Circle[]> {
    const memberships = await this.prisma.circleMembership.findMany({
      where: { userId, status: MemberStatus.APPROVED },
      include: { circle: true },
      orderBy: { joinedAt: "asc" },
    });
    return memberships.map((m) => m.circle);
  }

  /** Get circle detail + member list. Caller must be an APPROVED member. */
  async getDetail(circleId: string, userId: string): Promise<CircleDetail> {
    await this.requireApproved(circleId, userId);

    const circle = await this.prisma.circle.findUnique({ where: { id: circleId } });
    if (!circle) throw new NotFoundException("circle not found");

    const members = await this.prisma.circleMembership.findMany({
      where: { circleId, status: MemberStatus.APPROVED },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { joinedAt: "asc" },
    });

    return { circle, members };
  }

  /**
   * Returns true if the given user is an APPROVED member of the circle and
   * joined before `since`. Used by Phase 4+ to enforce the mid-bet-joiner rule.
   */
  async isEligible(circleId: string, userId: string, since: Date): Promise<boolean> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    return (
      !!m &&
      m.status === MemberStatus.APPROVED &&
      m.joinedAt !== null &&
      m.joinedAt <= since
    );
  }

  /**
   * Returns true if the user is a CREATOR of ANY circle that has other approved
   * members. Used by AuthService's account-deletion guard (spec §9.5).
   */
  async isSoleCreatorWithMembers(userId: string): Promise<boolean> {
    const creatorships = await this.prisma.circleMembership.findMany({
      where: { userId, role: MemberRole.CREATOR, status: MemberStatus.APPROVED },
    });
    for (const c of creatorships) {
      const otherCount = await this.prisma.circleMembership.count({
        where: {
          circleId: c.circleId,
          status: MemberStatus.APPROVED,
          userId: { not: userId },
        },
      });
      if (otherCount > 0) return true;
    }
    return false;
  }

  private async leaveAsCreator(circleId: string, userId: string): Promise<void> {
    // Find the next longest-standing APPROVED member to promote.
    const next = await this.prisma.circleMembership.findFirst({
      where: { circleId, status: MemberStatus.APPROVED, userId: { not: userId } },
      orderBy: { joinedAt: "asc" },
    });

    if (!next) {
      // No other members — delete the circle entirely.
      await this.prisma.circle.delete({ where: { id: circleId } });
      return;
    }

    // Transfer ownership, then remove the outgoing creator.
    await this.prisma.$transaction([
      this.prisma.circleMembership.update({
        where: { id: next.id },
        data: { role: MemberRole.CREATOR },
      }),
      this.prisma.circleMembership.delete({
        where: { circleId_userId: { circleId, userId } },
      }),
    ]);
  }

  private async requireRole(circleId: string, userId: string, role: MemberRole): Promise<void> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (!m || m.status !== MemberStatus.APPROVED || m.role !== role) {
      throw new ForbiddenException("only the circle creator can perform this action");
    }
  }

  private async requireApproved(circleId: string, userId: string): Promise<void> {
    const m = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });
    if (!m || m.status !== MemberStatus.APPROVED) {
      throw new ForbiddenException("you are not a member of this circle");
    }
  }

  // ─── Invite links (spec §9, Phase 9) ──────────────────────────────────────

  /**
   * Generate (or refresh) a shareable invite link for the circle.
   * Only the circle creator can call this. One token per circle; regenerating
   * replaces the previous one. Deep-link format: wager://join/{token}
   */
  async generateInviteLink(circleId: string, userId: string) {
    await this.requireRole(circleId, userId, MemberRole.CREATOR);

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_EXPIRY_MS);

    await this.prisma.circleInviteToken.upsert({
      where: { circleId },
      create: { circleId, token, expiresAt },
      update: { token, expiresAt },
    });

    return { url: `wager://join/${token}`, expiresAt };
  }

  /** Revoke the active invite link (creator only). */
  async revokeInviteLink(circleId: string, userId: string): Promise<void> {
    await this.requireRole(circleId, userId, MemberRole.CREATOR);
    await this.prisma.circleInviteToken.deleteMany({ where: { circleId } });
  }

  /**
   * Auto-approve the caller into the circle identified by the invite token.
   * Sharing the link is implicit consent — anyone with the link is approved.
   */
  async joinViaInviteToken(token: string, userId: string): Promise<CircleMembership> {
    const invite = await this.prisma.circleInviteToken.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException("invite link is invalid or has been revoked");
    if (invite.expiresAt < new Date()) throw new BadRequestException("invite link has expired");

    const circleId = invite.circleId;

    const existing = await this.prisma.circleMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });

    if (existing) {
      if (existing.status === MemberStatus.APPROVED) {
        throw new ConflictException("you are already a member of this circle");
      }
      // Upgrade a PENDING request to APPROVED immediately
      const m = await this.prisma.circleMembership.update({
        where: { circleId_userId: { circleId, userId } },
        data: { status: MemberStatus.APPROVED, joinedAt: new Date() },
      });
      void this.notifyMemberJoined(circleId, userId);
      return m;
    }

    const m = await this.prisma.circleMembership.create({
      data: {
        circleId,
        userId,
        role: MemberRole.MEMBER,
        status: MemberStatus.APPROVED,
        joinedAt: new Date(),
      },
    });
    void this.notifyMemberJoined(circleId, userId);
    return m;
  }

  private async notifyMemberJoined(circleId: string, newUserId: string): Promise<void> {
    const others = await this.prisma.circleMembership.findMany({
      where: { circleId, status: MemberStatus.APPROVED, userId: { not: newUserId } },
      select: { userId: true },
    });
    await this.notifications.send(
      others.map((m) => m.userId),
      NotificationTrigger.CIRCLE_MEMBER_JOINED,
      { title: "New member joined", body: "Someone new joined your circle.", data: { circleId } },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async checkNoActiveStake(_circleId: string, _userId: string): Promise<void> {
    // Stake table added in Phase 5. Until then no stakes exist.
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async checkNoActiveBet(_circleId: string): Promise<void> {
    // Bet table added in Phase 4. Until then no bets exist.
  }
}
