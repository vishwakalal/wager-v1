import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { PhoneVerifiedGuard } from "../auth/phone-verified.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SearchService } from "./search.service";

@Controller("search")
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * Search users by username. Returns up to 20 matches, excluding the caller.
   * Intended for the circle-invite flow: find a user, then POST /circles/:id/invite.
   * GET /search/users?q=vishwa
   */
  @Get("users")
  searchUsers(@CurrentUser() user: User, @Query("q") q?: string) {
    if (!q?.trim()) throw new BadRequestException("q is required");
    return this.search.searchUsers(q, user.id);
  }

  /**
   * Search circles by name. Returns up to 20 matches, excluding circles the
   * caller already belongs to. Intended for the join-request flow: find a
   * circle, then POST /circles/:id/request.
   * GET /search/circles?q=squad
   */
  @Get("circles")
  searchCircles(@CurrentUser() user: User, @Query("q") q?: string) {
    if (!q?.trim()) throw new BadRequestException("q is required");
    return this.search.searchCircles(q, user.id);
  }
}
