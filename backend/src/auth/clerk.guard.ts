import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { verifyToken } from "@clerk/backend";
import { AuthService } from "./auth.service";

/**
 * Verifies the Clerk session JWT from `Authorization: Bearer <token>`.
 * On first-seen clerkId, upserts the User row (spec §9.1).
 *
 * Dev bypass (non-production only): if no bearer token is present but an
 * `x-user-id` header is, looks up that user directly. This preserves the dev
 * workflow from Phase 1 without weakening production security.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = this.extractBearer(req);

    if (!token) {
      if (process.env["NODE_ENV"] !== "production") {
        const devUserId = req.headers["x-user-id"] as string | undefined;
        if (devUserId) {
          const user = await this.auth.findById(devUserId);
          if (user && !user.deletedAt) {
            req.user = user;
            return true;
          }
        }
      }
      throw new UnauthorizedException("missing or invalid authorization token");
    }

    let clerkId: string;
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
      });
      clerkId = payload.sub;
    } catch {
      throw new UnauthorizedException("invalid or expired token");
    }

    const user = await this.auth.upsertFromClerk(clerkId);
    if (user.deletedAt) throw new UnauthorizedException("account has been deleted");
    req.user = user;
    return true;
  }

  private extractBearer(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return undefined;
    return header.slice(7).trim() || undefined;
  }
}
