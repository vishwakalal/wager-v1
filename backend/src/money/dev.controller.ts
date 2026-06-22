import { randomUUID } from "node:crypto";
import { Controller, ForbiddenException, Post } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "./wallet.service";

/**
 * Dev-only helpers (disabled in production). Creates throwaway users with a
 * synthetic clerkId so the Phase 1-era wallet endpoints remain curl-able
 * without a real Clerk JWT. Use the returned `userId` as the `x-user-id`
 * header on wallet requests. Real users arrive via Clerk from Phase 2 onward.
 */
@Controller("dev")
export class DevController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
  ) {}

  @Post("users")
  async createUser(): Promise<{ userId: string; clerkId: string; phone: string }> {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("dev endpoints are disabled in production");
    }
    const clerkId = `dev_${randomUUID()}`;
    const phone = `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const user = await this.prisma.user.create({
      data: {
        clerkId,
        displayName: "Dev User",
        phone,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      },
    });
    await this.wallets.ensureWallet(user.id);
    return { userId: user.id, clerkId, phone };
  }
}
