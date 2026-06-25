import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { PhoneVerifiedGuard } from "../auth/phone-verified.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { NotificationService } from "./notification.service";

@Controller("notifications")
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /** Register an Expo push token for the caller's device. */
  @Post("token")
  @HttpCode(200)
  registerToken(
    @CurrentUser() user: User,
    @Body() body: { token?: string; platform?: string },
  ) {
    if (!body.token?.trim()) throw new BadRequestException("token is required");
    if (!body.platform?.trim()) throw new BadRequestException("platform is required");
    return this.notifications.registerToken(user.id, body.token.trim(), body.platform.trim());
  }

  /** Unregister an Expo push token (e.g. on logout or device switch). */
  @Delete("token")
  @HttpCode(200)
  removeToken(@CurrentUser() user: User, @Body() body: { token?: string }) {
    if (!body.token?.trim()) throw new BadRequestException("token is required");
    return this.notifications.removeToken(user.id, body.token.trim());
  }

  /**
   * Return the full preference matrix (all 26 triggers with current enabled state,
   * accounting for spec defaults). Used by the settings screen (Phase 11).
   */
  @Get("preferences")
  getPreferences(@CurrentUser() user: User) {
    return this.notifications.getPreferences(user.id);
  }

  /**
   * Bulk-update notification preferences. Each entry overrides the spec default
   * for that trigger. Missing triggers keep their current/default value.
   */
  @Patch("preferences")
  @HttpCode(200)
  updatePreferences(
    @CurrentUser() user: User,
    @Body() body: { updates?: Array<{ trigger: string; enabled: boolean }> },
  ) {
    if (!Array.isArray(body.updates)) throw new BadRequestException("updates[] is required");
    return this.notifications.updatePreferences(user.id, body.updates);
  }
}
