import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

/**
 * Thin emitter injected into domain services so they can push live events
 * to connected clients without knowing about Socket.io directly.
 * The server reference is set by RealtimeGateway.afterInit().
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToCircle(circleId: string, event: string, data: unknown): void {
    this.server?.to(`circle:${circleId}`).emit(event, data);
  }

  emitToBet(betId: string, event: string, data: unknown): void {
    this.server?.to(`bet:${betId}`).emit(event, data);
  }
}
