import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";

/**
 * Backend entrypoint. The API is the single source of truth for all money and
 * all timers (see BUILD_PLAN.md §1). It binds to 0.0.0.0 so a phone running the
 * Expo app can reach it over the LAN during development.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // dev: allow the Expo client from any origin
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix("api");

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`Wager API listening on http://0.0.0.0:${port}/api`);
}

void bootstrap();
