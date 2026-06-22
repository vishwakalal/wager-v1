import { Injectable } from "@nestjs/common";
import { MemberStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface UserResult {
  id: string;
  username: string;
  displayName: string | null;
}

export interface CircleResult {
  id: string;
  name: string;
  memberCount: number;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search users by username prefix/substring (case-insensitive).
   * Returns up to 20 results. Excludes the calling user and deleted accounts.
   * Used to find people to invite to a circle.
   */
  async searchUsers(query: string, callerId: string): Promise<UserResult[]> {
    const term = query.toLowerCase().trim();
    if (!term) return [];

    const users = await this.prisma.user.findMany({
      where: {
        username: { contains: term, mode: "insensitive" },
        id: { not: callerId },
        deletedAt: null,
        phoneVerified: true,
      },
      select: { id: true, username: true, displayName: true },
      orderBy: { username: "asc" },
      take: 20,
    });

    return users.map((u) => ({
      id: u.id,
      username: u.username!,
      displayName: u.displayName,
    }));
  }

  /**
   * Search circles by name (case-insensitive). Returns up to 20 results,
   * excluding circles the caller is already a member of.
   * Used to find a circle to request joining.
   */
  async searchCircles(query: string, callerId: string): Promise<CircleResult[]> {
    const term = query.trim();
    if (!term) return [];

    const callerMembershipIds = await this.prisma.circleMembership
      .findMany({
        where: { userId: callerId },
        select: { circleId: true },
      })
      .then((ms) => ms.map((m) => m.circleId));

    const circles = await this.prisma.circle.findMany({
      where: {
        name: { contains: term, mode: "insensitive" },
        id: { notIn: callerMembershipIds.length ? callerMembershipIds : ["__none__"] },
      },
      include: {
        _count: { select: { memberships: { where: { status: MemberStatus.APPROVED } } } },
      },
      orderBy: { name: "asc" },
      take: 20,
    });

    return circles.map((c) => ({
      id: c.id,
      name: c.name,
      memberCount: c._count.memberships,
    }));
  }
}
