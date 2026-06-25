export interface ChatUserToken {
  userId: string;
  token: string;
}

/**
 * Abstraction over the chat backend (Stream in prod, stub in dev).
 * Flip CHAT_PROVIDER=stream in .env and supply STREAM_API_KEY/SECRET to switch.
 */
export abstract class ChatProvider {
  abstract getUserToken(userId: string, displayName: string): Promise<ChatUserToken>;
  abstract ensureCircleChannel(circleId: string, memberIds: string[]): Promise<void>;
  abstract ensureBetChannel(betId: string, circleId: string, memberIds: string[]): Promise<void>;
}
