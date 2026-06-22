import { randomUUID } from "node:crypto";
import { Controller, ForbiddenException, Post } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "./wallet.service";

/**
 * Dev-only helpers that stand in for features not built yet (real auth is
 * Phase 2). Disabled when NODE_ENV=production. Lets us create a throwaway user
 * + wallet to exercise the wallet API end to end.
 */
@Controller("dev")
export class DevController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
  ) {}

  @Post("users")
  async createUser(): Promise<{ userId: string; phone: string }> {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("dev endpoints are disabled in production");
    }
    const phone = `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    const user = await this.prisma.user.create({
      data: { id: randomUUID(), phone },
    });
    await this.wallets.ensureWallet(user.id);
    return { userId: user.id, phone };
  }
}
