import { Controller, Get, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { PhoneVerifiedGuard } from "../auth/phone-verified.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ChatService } from "./chat.service";

@Controller("chat")
@UseGuards(ClerkAuthGuard, PhoneVerifiedGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Return a Stream Chat user token for the caller. The frontend uses this to init the SDK. */
  @Get("token")
  getToken(@CurrentUser() user: User) {
    return this.chat.getUserToken(user.id, user.displayName ?? user.id);
  }
}
