import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { ChatProvider } from "./chat.provider";
import { StubChatProvider } from "./stub-chat.provider";
import { StreamChatProvider } from "./stream-chat.provider";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: ChatProvider,
      useFactory: (config: ConfigService): ChatProvider => {
        if (config.get<string>("CHAT_PROVIDER") === "stream") {
          const key = config.getOrThrow<string>("STREAM_API_KEY");
          const secret = config.getOrThrow<string>("STREAM_API_SECRET");
          return new StreamChatProvider(key, secret);
        }
        return new StubChatProvider();
      },
      inject: [ConfigService],
    },
    ChatService,
  ],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
