import { Controller, Get } from "@nestjs/common";

/** Liveness probe — also what the Expo app pings to confirm connectivity. */
@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok"; service: string; timestamp: string } {
    return {
      status: "ok",
      service: "wager-api",
      timestamp: new Date().toISOString(),
    };
  }
}
