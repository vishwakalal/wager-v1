import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { RealtimeService } from "./realtime.service";

/**
 * Socket.io gateway — clients join named rooms to receive live updates.
 *
 * Room naming:
 *   circle:{id}  — circle-level events (new bets, member changes)
 *   bet:{id}     — bet-level events (status, odds, verification, disputes)
 */
@WebSocketGateway({ cors: { origin: "*" } })
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly realtime: RealtimeService) {}

  afterInit(server: Server): void {
    this.realtime.setServer(server);
  }

  @SubscribeMessage("join:circle")
  joinCircle(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { circleId: string },
  ): void {
    void client.join(`circle:${data.circleId}`);
  }

  @SubscribeMessage("join:bet")
  joinBet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { betId: string },
  ): void {
    void client.join(`bet:${data.betId}`);
  }

  @SubscribeMessage("leave:circle")
  leaveCircle(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { circleId: string },
  ): void {
    void client.leave(`circle:${data.circleId}`);
  }

  @SubscribeMessage("leave:bet")
  leaveBet(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { betId: string },
  ): void {
    void client.leave(`bet:${data.betId}`);
  }
}
