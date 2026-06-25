import { Injectable, Logger } from "@nestjs/common";
import { StreamChat } from "stream-chat";
import { ChatProvider, type ChatUserToken } from "./chat.provider";

/** Production chat provider — wraps the Stream Chat server SDK. */
@Injectable()
export class StreamChatProvider extends ChatProvider {
  private readonly logger = new Logger(StreamChatProvider.name);
  private readonly client: StreamChat;

  constructor(apiKey: string, apiSecret: string) {
    super();
    this.client = StreamChat.getInstance(apiKey, apiSecret);
  }

  async getUserToken(userId: string, displayName: string): Promise<ChatUserToken> {
    await this.client.upsertUser({ id: userId, name: displayName });
    const token = this.client.createToken(userId);
    return { userId, token };
  }

  async ensureCircleChannel(circleId: string, memberIds: string[]): Promise<void> {
    const ch = this.client.channel("messaging", `circle-${circleId}`, {
      name: "Circle Chat",
      members: memberIds,
    });
    await ch.create();
    this.logger.log(`stream channel ready: circle-${circleId}`);
  }

  async ensureBetChannel(betId: string, _circleId: string, memberIds: string[]): Promise<void> {
    const ch = this.client.channel("messaging", `bet-${betId}`, {
      name: "Bet Chat",
      members: memberIds,
    });
    await ch.create();
    this.logger.log(`stream channel ready: bet-${betId}`);
  }
}
