import { Injectable } from "@nestjs/common";
import { ChatProvider } from "./chat.provider";

@Injectable()
export class ChatService {
  constructor(private readonly provider: ChatProvider) {}

  getUserToken(userId: string, displayName: string) {
    return this.provider.getUserToken(userId, displayName);
  }

  ensureCircleChannel(circleId: string, memberIds: string[]) {
    return this.provider.ensureCircleChannel(circleId, memberIds);
  }

  ensureBetChannel(betId: string, circleId: string, memberIds: string[]) {
    return this.provider.ensureBetChannel(betId, circleId, memberIds);
  }
}
