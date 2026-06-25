import { Injectable } from "@nestjs/common";
import { ChatProvider, type ChatUserToken } from "./chat.provider";

/** Dev stub — returns a deterministic fake token so the app can boot without Stream credentials. */
@Injectable()
export class StubChatProvider extends ChatProvider {
  async getUserToken(userId: string): Promise<ChatUserToken> {
    return { userId, token: `stub_${userId}` };
  }
  async ensureCircleChannel(): Promise<void> { /* no-op */ }
  async ensureBetChannel(): Promise<void> { /* no-op */ }
}
