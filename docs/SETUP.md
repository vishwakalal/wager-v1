# Setup

How to get Wager running on a machine. Dev state lives in shared cloud services
(Neon Postgres, Upstash Redis) so it follows you between your two devices — no
Docker required.

## Prerequisites

- Node.js >= 20 (developed on v24)
- Git

## First-time setup

```bash
git clone https://github.com/vishwakalal/wager-v1.git
cd wager-v1
npm install            # installs all workspaces; runs `prisma generate` for the backend
```

### Environment variables

Secrets are **never committed**. Each app has its own `.env` (gitignored) with a
committed `.env.example` showing the shape.

```bash
cp backend/.env.example backend/.env
# then paste the real values into backend/.env
```

You need:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Neon dashboard → Project → Connection string |
| `UPSTASH_REDIS_REST_URL` | Upstash dashboard → your Redis DB → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | same Upstash page |

Both Neon and Upstash are free-tier and shared across devices, so the **same**
`.env` values work on both of your machines.

### Apply the database schema

Migrations are committed in `backend/prisma/migrations`. On a fresh machine the
cloud DB is already migrated, but to be safe / after pulling new migrations:

```bash
npm run db:migrate -w @wager/backend     # applies pending migrations
```

## Running

```bash
# Backend (NestJS) — http://localhost:3000/api
npm run dev -w @wager/backend

# Frontend (Expo) — in a second terminal
npm run start -w @wager/frontend
```

Verify the stack is healthy:

```bash
curl http://localhost:3000/api/health
# => {"status":"ok","service":"wager-api","db":true,"redis":true,...}
```

`db` and `redis` both `true` means Neon and Upstash are reachable.

## The repo-wide gate

Before committing, run from the root:

```bash
npm run check     # typecheck + test across every workspace
```

## Working on `packages/shared`

The backend consumes `@wager/shared` as a **compiled** CommonJS build (`dist/`).
`npm install` and `npm run check` build it for you, but if you edit shared while
the backend is running, rebuild it so the change is picked up:

```bash
npm run build -w @wager/shared
```

## Useful backend DB commands

```bash
npm run db:migrate  -w @wager/backend   # create/apply a migration in dev
npm run db:generate -w @wager/backend   # regenerate the Prisma client
npm run db:studio   -w @wager/backend   # open Prisma Studio (DB GUI)
```
