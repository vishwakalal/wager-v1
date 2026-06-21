# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Wager is a social prediction-market app for friend groups (real-money wagers on everyday
events, run inside persistent invite-only "circles"). Two authoritative documents drive all
work — **read them before making non-trivial changes**:

- `Wager_ProductSpec.md` — the product spec. The source of truth for every rule and threshold.
- `BUILD_PLAN.md` — the phased engineering roadmap. Tells you what phase the project is in,
  what's next, and the acceptance criteria for each phase. Update its status/checkboxes as
  phases complete.

## Repository layout

npm-workspaces monorepo (Node >= 20):

```
packages/shared   # @wager/shared — pure, dependency-free domain logic + types + constants
apps/api          # NestJS backend (source of truth) — planned, scaffolded per BUILD_PLAN phases
apps/mobile       # React Native + Expo app — planned
```

Only `packages/shared` exists so far; `apps/*` are added as the build plan progresses.

## Commands

Run from the repo root:

```bash
npm install                  # install all workspaces
npm run check                # typecheck + test across every workspace (the gate before committing)
npm run typecheck            # tsc --noEmit across workspaces
npm run test                 # run all workspace test suites
```

Within `packages/shared`:

```bash
npm test -w @wager/shared                                # run the package's vitest suite once
npm run test:watch -w @wager/shared                      # watch mode
npx vitest run packages/shared/src/parimutuel.test.ts    # a single test file
npx vitest run -t "Under wins" packages/shared           # a single test by name (-t pattern)
```

## Architecture: the two things that must stay correct

The product's risk is concentrated in two places. Treat changes here with extra care and
keep them covered by the existing tests.

### 1. Financial math lives in `packages/shared` and is pure

All money is **integer cents** (`Cents`), never floating-point dollars — this is what makes
the ledger provably balance. The critical functions:

- `parimutuel.ts` — `computeParimutuelPayouts`: winners get stake back + a proportional
  share of the losing pool. Payouts use `allocateProportional` (largest-remainder method in
  `money.ts`) so the entire pool is distributed with **no cent created or lost**.
- `line.ts` — `trimmedMeanLine`: blind line setting; drops one min + one max, averages the rest.
- `staking.ts` — `resolveStaking`: applies the **5× relative cap** (no one stakes more than 5×
  the lowest staker; excess refunded) and detects void conditions (no stakes / one-sided).
- `constants.ts` — **single source of truth for every spec threshold** (window durations,
  voting thresholds, min stake, cap multiple, rake bps, OTP rules). Both API and mobile import
  these; never hardcode a rule value anywhere else.

The spec's worked examples (e.g. §4.3 payout walk-through) are encoded directly as tests in
`*.test.ts` — they are the contract. If you change financial logic, these must still pass.

### 2. The money abstraction (virtual now, real money later)

v1 runs on **virtual currency**, but the architecture is built so switching to real money
(Stripe Connect) is plug-and-play: implement one provider + flip a config flag, with **zero
changes to bet/stake/resolution logic**. When building the API, route every external money
movement through the planned `PaymentProvider` interface (`VirtualProvider` today,
`StripeConnectProvider` later). The ledger is **append-only/double-entry even for virtual
money**; "balance" is always derived, never a mutable field. See `BUILD_PLAN.md` §2.3.

Time-driven behavior (staking windows, line challenge window, 24h post-expiration dispute
window, tiebreaker re-votes, auto-void/resolve) is owned by the backend via a durable
Postgres-backed job table — never trust the client for deadlines or money. See `BUILD_PLAN.md` §2.4.

## TypeScript conventions

- Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` is on — array
  access is `T | undefined`, so the `!` non-null assertion appears intentionally after bounds
  are known. Match the surrounding style.
- ESM throughout: intra-package imports use explicit `.js` extensions (e.g. `./money.js`)
  even though the source is `.ts`.

## Environment / two-machine setup

Solo dev across two machines. Dev state lives in shared free-tier cloud services (Neon
Postgres, Upstash Redis) so it follows you between devices — no Docker required (an optional
`docker-compose.yml` is a fallback only). Secrets live in per-app `.env` (never committed);
keep `.env.example` current. SMS OTP and payments are stubbed/virtual in dev.
