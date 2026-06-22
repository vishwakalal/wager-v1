import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { createClerkClient } from "@clerk/backend";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../money/wallet.service";
import { PHONE_VERIFIER, type PhoneVerifier } from "./phone/phone-verifier";

@Injectable()
export class AuthService {
  private readonly clerk = createClerkClient({
    secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    @Inject(PHONE_VERIFIER) private readonly phoneVerifier: PhoneVerifier,
  ) {}

  /**
   * Called by ClerkAuthGuard on every authenticated request. Creates the User
   * row on the very first request from a given Clerk account and keeps
   * `displayName` in sync with Clerk's profile.
   */
  async upsertFromClerk(clerkId: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { clerkId } });
    if (existing) return existing;

    let displayName: string | undefined;
    try {
      const clerkUser = await this.clerk.users.getUser(clerkId);
      const parts = [clerkUser.firstName, clerkUser.lastName].filter(Boolean);
      displayName = parts.length > 0 ? parts.join(" ") : undefined;
    } catch {
      // Non-fatal: user record still created without a display name.
    }

    const user = await this.prisma.user.create({
      data: { clerkId, displayName: displayName ?? null },
    });
    await this.wallets.ensureWallet(user.id);
    return user;
  }

  async findById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { clerkId } });
  }

  /**
   * Set or update the user's unique username. Normalized to lowercase.
   * Rules: 3–20 chars, starts with a letter, only letters/digits/underscores.
   */
  async setUsername(userId: string, raw: string): Promise<User> {
    const username = raw.toLowerCase().trim();
    if (!/^[a-z][a-z0-9_]{2,19}$/.test(username)) {
      throw new BadRequestException(
        "username must be 3–20 characters, start with a letter, and contain only letters, numbers, and underscores",
      );
    }

    const taken = await this.prisma.user.findUnique({ where: { username } });
    if (taken && taken.id !== userId) {
      throw new ConflictException("that username is already taken");
    }

    return this.prisma.user.update({ where: { id: userId }, data: { username } });
  }

  /**
   * Send an OTP to the given phone number. Rejects if the number is already
   * verified by a different account (spec §9.2: one phone per account globally).
   */
  async sendOtp(userId: string, phone: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.phoneVerified) {
      throw new BadRequestException("phone is already verified");
    }
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing && existing.id !== userId) {
      throw new ConflictException("phone number is already in use");
    }
    await this.phoneVerifier.send(userId, phone);
  }

  /**
   * Verify the OTP for `userId`. On success, marks `phone` as verified and
   * locks the number to this account forever (spec §9.2: immutable after verify).
   */
  async verifyOtp(userId: string, phone: string, code: string): Promise<User> {
    const user = await this.requireUser(userId);
    if (user.phoneVerified) {
      throw new BadRequestException("phone is already verified");
    }

    const result = await this.phoneVerifier.verify(userId, code);
    if (!result.success) {
      const messages: Record<string, string> = {
        invalid_code: "incorrect verification code",
        expired: "OTP has expired — please request a new code",
        max_attempts: "too many failed attempts — please request a new code",
      };
      throw new BadRequestException(messages[result.error ?? "invalid_code"]);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerified: true, phoneVerifiedAt: new Date() },
    });
  }

  /**
   * Soft-delete an account per spec §9.5. Guards run first; on pass, personal
   * data is wiped while financial rows are retained (5-yr legal requirement).
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.requireUser(userId);

    // Guard: positive balance (must withdraw first).
    const balance = await this.wallets.getBalance(userId);
    if (balance.total > 0) {
      throw new ConflictException(
        "cannot delete account with a positive balance — withdraw funds first",
      );
    }

    // Guard: active stake. Full check added in Phase 5 when Stake table exists;
    // placeholder always passes for now.
    await this.checkNoActiveStake(userId);

    // Guard: sole circle creator. Full check added in Phase 3.
    await this.checkNotSoleCircleCreator(userId);

    // Anonymize personal data immediately; keep row for financial record retention.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: "Deleted User",
        phone: null,
        phoneVerified: false,
        deletedAt: new Date(),
      },
    });

    // Revoke the Clerk account so they can't log in again.
    try {
      await this.clerk.users.deleteUser(user.clerkId);
    } catch {
      // Non-fatal: local anonymization already completed.
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async checkNoActiveStake(_userId: string): Promise<void> {
    // Stake table added in Phase 5. Until then, no stakes can exist.
  }

  private async checkNotSoleCircleCreator(userId: string): Promise<void> {
    const creatorships = await this.prisma.circleMembership.findMany({
      where: { userId, role: "CREATOR", status: "APPROVED" },
    });
    for (const c of creatorships) {
      const otherCount = await this.prisma.circleMembership.count({
        where: { circleId: c.circleId, status: "APPROVED", userId: { not: userId } },
      });
      if (otherCount > 0) {
        throw new ConflictException(
          "cannot delete account while you are the creator of a circle with other members — transfer ownership first",
        );
      }
    }
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException("user not found");
    return user;
  }
}
