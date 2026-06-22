import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { PhoneVerifiedGuard } from "../auth/phone-verified.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CirclesService } from "./circles.service";

@Controller("circles")
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class CirclesController {
  constructor(private readonly circles: CirclesService) {}

  /** Create a new circle. The caller becomes its CREATOR. */
  @Post()
  create(
    @CurrentUser() user: User,
    @Body() body: { name?: string },
  ) {
    if (!body.name?.trim()) throw new BadRequestException("name is required");
    return this.circles.create(user.id, body.name.trim());
  }

  /** List all circles the caller is an approved member of. */
  @Get()
  list(@CurrentUser() user: User) {
    return this.circles.listMine(user.id);
  }

  /** Get circle detail and its approved member list. */
  @Get(":id")
  getDetail(@CurrentUser() user: User, @Param("id") circleId: string) {
    return this.circles.getDetail(circleId, user.id);
  }

  /** Invite a user into the circle (creator only). Creates a PENDING membership. */
  @Post(":id/invite")
  @HttpCode(200)
  invite(
    @CurrentUser() user: User,
    @Param("id") circleId: string,
    @Body() body: { userId?: string },
  ) {
    if (!body.userId) throw new BadRequestException("userId is required");
    return this.circles.invite(circleId, user.id, body.userId);
  }

  /** Approve a pending member (creator only). Sets joinedAt to now. */
  @Post(":id/approve/:userId")
  @HttpCode(200)
  approve(
    @CurrentUser() user: User,
    @Param("id") circleId: string,
    @Param("userId") targetUserId: string,
  ) {
    return this.circles.approve(circleId, user.id, targetUserId);
  }

  /**
   * Request to join a circle (user-initiated, after finding it via search).
   * Creates a PENDING membership — the creator still must approve via
   * POST /circles/:id/approve/:userId.
   */
  @Post(":id/request")
  @HttpCode(200)
  requestToJoin(@CurrentUser() user: User, @Param("id") circleId: string) {
    return this.circles.requestToJoin(circleId, user.id);
  }

  /**
   * Leave the circle. Creator leaving transfers ownership to the
   * longest-standing member (or deletes the circle if no others remain).
   */
  @Delete(":id/leave")
  @HttpCode(200)
  leave(@CurrentUser() user: User, @Param("id") circleId: string) {
    return this.circles.leave(circleId, user.id);
  }
}
