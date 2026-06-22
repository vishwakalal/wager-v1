import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { User } from "@prisma/client";

/**
 * Requires the account to be fully activated: username chosen AND phone
 * verified via OTP (spec §9.2). Both steps are part of onboarding and must
 * complete before the user can access core app features. The phone/send,
 * phone/verify, and username endpoints are intentionally exempt — they are
 * how the user completes activation.
 */
@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: User }>();

    if (!req.user?.username) {
      throw new ForbiddenException(
        "a username is required before using this feature — set one at POST /auth/username",
      );
    }

    if (!req.user?.phoneVerified) {
      throw new ForbiddenException(
        "phone verification required before using this feature",
      );
    }

    return true;
  }
}
