# Wager — Build Plan

**Companion to:** `Wager_ProductSpec.md` (v1.0)
**Owner:** solo developer (two machines)
**Status:** living document — update as phases complete

---

## 0. How to read this document

This is the end-to-end build plan for Wager. It translates the product spec into an
ordered, testable engineering roadmap. Every phase has **goals**, **tasks**, and
**acceptance criteria** (a phase is "done" only when its acceptance criteria pass).

Three decisions frame everything below (locked in with the product owner):

1. **Virtual currency first, real money plug-and-play later.** We build the entire
   product on a virtual wallet now. *All* money flows go through a `PaymentProvider`
   abstraction with a `VirtualProvider` implementation. Switching to real money =
   implement `StripeConnectProvider` + flip a config flag + do the compliance work.
   **No bet / stake / resolution logic ever changes.**
2. **Solo dev across two machines.** Setup must be reproducible and portable. State
   lives in shared free-tier cloud services so it follows you between devices. No
   machine-specific steps; everything in git + `.env`.
3. **Free/cheap during dev & testing, expand budget at deploy.** Every service used in
   development has a free tier. Paid tiers only get switched on at deployment.

---

## 1. Guiding principles

- **Correctness over features.** The two areas that *must* be bulletproof are the
  **time-driven state machine** (windows opening/closing, soft expiration, auto-void /
  auto-resolve) and the **financial math** (trimmed-mean line, parimutuel payouts, 5×
  relative cap refunds, ledger integrity). These get the most tests and the earliest
  attention.
- **Server is the source of truth.** Clients never compute odds, payouts, or window
  state authoritatively. The backend owns all money and all timers. Clients render.
- **Money is a ledger, never a mutable balance field.** Every balance change is an
  append-only ledger entry. "Balance" is a derived/cached value. This is true even for
  virtual currency, so the model is real-money-ready from day one.
- **Idempotency everywhere money moves.** Every financial operation takes an idempotency
  key. Replays must never double-charge or double-pay.
- **Everything testable headlessly.** Core domain logic lives in a pure, dependency-free
  package so it can be unit-tested without a DB, network, or device.

---

## 2. Architecture

### 2.1 Monorepo layout (npm workspaces)

```
wager-v1/
├─ package.json              # workspace root, shared scripts
├─ tsconfig.base.json        # shared TS config
├─ BUILD_PLAN.md
├─ Wager_ProductSpec.md
├─ docker-compose.yml        # OPTIONAL local Postgres+Redis (fallback only)
├─ backend/                  # @wager/backend — NestJS backend (source of truth)
├─ frontend/                 # @wager/frontend — React Native + Expo app
└─ packages/
   └─ shared/                # pure TS: domain types + money/line/odds logic + zod schemas
```

Rationale: shared types and the critical pure logic (parimutuel, trimmed mean,
validation schemas) are written **once** and consumed by both API and mobile. Prevents
client/server drift on the rules that matter.

### 2.2 Stack (per spec §14)

| Layer | Tech | Dev-phase choice (free) |
|---|---|---|
| Mobile | React Native + Expo | Expo Go / dev client, free |
| Backend | Node.js + NestJS | runs locally; deploy later |
| DB | PostgreSQL | **Neon** free tier (shared across devices) |
| Cache/Realtime state | Redis | **Upstash** free tier |
| Realtime transport | Socket.io | runs in API process |
| Chat & media | Stream | Stream free dev tier (abstracted) |
| Media storage | AWS S3 + CloudFront | deferred; local/stub in dev |
| Auth | Clerk (Google/Apple/email + SMS OTP via Twilio) | Clerk free tier; **SMS stubbed in dev** |
| Payments | Stripe Connect | **abstracted — Virtual in dev** |
| Push | Expo Push | free |
| Hosting | Railway or Render | deploy phase only |

### 2.3 The financial abstraction (the core of "plug-and-play")

Everything money-related is defined by interfaces in `packages/shared` and implemented in
the API. This is the seam that lets us swap virtual → real with zero changes to game logic.

```
PaymentProvider           # deposits & withdrawals (external money in/out)
  ├─ VirtualProvider      # dev: instantly credits/debits virtual funds
  └─ StripeConnectProvider# later: Stripe Payment Intents / ACH / Connect Payouts

LedgerService             # append-only double-entry ledger (always real, even for virtual $)
WalletService             # derived balances, holds/escrow, reconciliation
EscrowService             # locks stakes for a bet, releases on resolve/void/cancel
```

Real-money-ready fields carried from day one (even while unused):
- `transactions`: `idempotency_key`, `provider`, `provider_ref`, `status`, `type`
- `wallets`: `available`, `held` (escrow), derived from ledger
- placeholders for `payment_methods` (Stripe/Plaid linkage), KYC status on user
- `feature flags`: `MONEY_MODE = virtual | real`

When we flip to real money: implement `StripeConnectProvider`, wire webhooks, set
`MONEY_MODE=real`, complete compliance (§16). Bets/stakes/resolution untouched.

### 2.4 The time / scheduling engine (the other core)

Many spec behaviors are *deadline-driven* and must fire even if no user is online:
line challenge window (30m), staking windows (1h/24h/48h), 30-min staking warning,
verification re-vote (30m), soft expiration → 24h dispute window, 2h dispute warning,
auto-void, auto-resolve.

Design: a **durable scheduled-jobs table** (Postgres) + a worker that polls due jobs and
transitions bet/verification state machines. Redis used for fast counters/locks, **not** as
the source of truth for deadlines (Redis is a cache; jobs survive restarts in Postgres).
Every transition is idempotent and guarded by the bet's current status. (Library: start
with a Postgres-backed queue such as `pg-boss`; revisit BullMQ if needed.)

---

## 3. Domain model (high level)

Core entities (full schema defined in Phase 1):

- **User** — Clerk id, display name, phone (verified, immutable), stats, KYC placeholder
- **Circle** — name, creator, members (with join timestamp), status
- **CircleMembership** — user↔circle, role, joined_at, approval status
- **Bet** — circle, type (numeric|binary), duration, status, line (set), creator,
  timestamps for each window
- **LineSubmission** — bet, user, value, round (blind; revealed after collection)
- **Stake** — bet, user, side (over/under | yes/no), amount, capped_amount, refund_amount
- **VerificationEvent** — bet, submitter, description, status, evidence refs
- **Vote** — verification/dispute, user, choice, round (for tiebreaker re-vote)
- **Dispute** — bet, type (add|remove), target event, status, threshold (70%)
- **LedgerEntry** — append-only, double-entry (debit/credit), references
- **Transaction** — external money movement (deposit/withdraw), provider fields
- **Wallet** — derived available/held per user
- **CancellationVote** — bet, initiator, votes
- **NotificationPreference** — per user, 5 categories × triggers
- **ScheduledJob** — type, run_at, payload, status (the timing engine)

### 3.1 Bet state machine (numeric)

```
DRAFT
  → LINE_SETTING        (collect blind submissions)
  → LINE_CHALLENGE      (30m window; 50%+ dispute → back to LINE_SETTING)
  → STAKING             (1h/24h/48h; min $1, 5× cap, void if one-sided/empty)
  → ACTIVE              (🟡 verifications queued & voted)
  → CLOSED              (🟠 24h post-expiration: finalize pending + disputes)
  → RESOLVED (🟢)  |  VOIDED (🔴)  |  CANCELLED
```

Yes/No skips LINE_SETTING / LINE_CHALLENGE (no line). Min members: numeric 4, binary 2.

### 3.2 Key thresholds (single source of truth in `shared`)

| Rule | Value |
|---|---|
| Line challenge window | 30 min, 50%+ to redo |
| Staking windows | 1h / 24h / 48h by duration |
| Min stake | $1 |
| Relative cap | 5× lowest staker (excess auto-refunded) |
| Verification | 50% of staked members |
| Tiebreaker re-vote | 30 min; still tied → denied |
| Post-expiration window | 24 h |
| Dispute confirm | 70% of staked members |
| Cancellation vote | 50%+ of staked members |
| Rake (v1) | 0% (2% of losing pool when enabled) |
| Min withdrawal | $5 |

---

## 4. Environment & two-device workflow

- **Shared cloud dev services (free):** Neon (Postgres), Upstash (Redis). Both machines
  point at the same instances via `.env`, so dev data is consistent across devices.
- **Secrets:** `.env` per app, never committed. `.env.example` committed with every key.
  A short `docs/SETUP.md` lists exactly which dashboards to grab keys from.
- **Onboarding a second machine:** `git clone` → `npm install` → copy `.env` values →
  `npm run dev`. No Docker, no local DB install required.
- **Optional offline fallback:** `docker-compose.yml` provides local Postgres+Redis for
  anyone who installs Docker; not required.
- **Git hygiene:** feature branches off `main`, conventional commits, PRs optional (solo).
  Push at end of each work session so the other machine can pull.

---

## 5. Phased roadmap

Sequenced **core-loop-first** (most product/financial risk retired earliest), then the
supporting systems, then polish/deploy. Each phase is independently demoable.

### Phase 0 — Foundations & scaffolding
**Goal:** a running, type-safe monorepo with the riskiest pure logic already tested.
- npm workspaces root, `tsconfig.base.json`, lint/format (ESLint + Prettier), CI-lite
  script (`npm run check` = typecheck + lint + test).
- `packages/shared`: domain types + **parimutuel payout** + **trimmed-mean line** + 5×
  cap + zod validation schemas, all with exhaustive unit tests (incl. spec §4.3 example).
- NestJS API skeleton (health route) + Expo app skeleton (renders, hits health route).
- Neon + Upstash connected; Prisma (or TypeORM) wired with first migration.
- `docs/SETUP.md`, `.env.example`, optional `docker-compose.yml`.
- **Acceptance:** `npm run check` green; mobile app shows "API healthy"; shared math
  tests reproduce the spec's worked payout example exactly.

### Phase 1 — Data model & money ledger foundation
**Goal:** full schema + the financial abstraction, on virtual currency.
- All entities from §3 as migrations. Append-only `LedgerEntry`, `Transaction`, `Wallet`.
- `PaymentProvider` interface + `VirtualProvider`; `LedgerService`, `WalletService`,
  `EscrowService`. `MONEY_MODE=virtual` flag.
- Wallet endpoints: get balance, (virtual) deposit, (virtual) withdraw — all idempotent,
  all double-entry. Reconciliation test: sum of ledger == wallet balances.
- **Acceptance:** property test — random sequences of deposits/holds/releases/payouts
  never break ledger invariants (no negative available, held≤total, ledger balances to 0).

### Phase 2 — Auth & accounts (spec §9)
**Goal:** sign up / log in; phone verification abstracted (stubbed SMS in dev).
- Clerk integration (Google, Apple, email+password). API verifies Clerk session JWT.
- `PhoneVerifier` abstraction: `StubVerifier` in dev (fixed OTP), Twilio later. Rules:
  10-min expiry, 3 attempts, one-number-per-account, immutable after verify.
- Account deletion policy guards (§9.5): block on active stake / positive balance /
  sole circle creator; anonymize history; 5-yr financial retention.
- **Acceptance:** can create account on device A, log in on device B; phone uniqueness
  enforced; deletion guards return correct errors.

### Phase 3 — Circles (spec §2.1, build-order 2)
**Goal:** circles, invites, approval, membership rules.
- Create circle, invite, creator-approves-join, leave rules (not while active
  participant; creator can't leave while a bet is active), join-mid-bet restriction.
- Circle view data: stat cards, member list.
- **Acceptance:** full membership lifecycle enforced per §2.1; mid-bet joiner is blocked
  from participating in in-progress bets.

### Phase 4 — Bet creation + blind line setting (spec §3, build-order 3–4)
**Goal:** create both bet types; trimmed-mean line with challenge window.
- Bet creation (type, duration, min-member checks). Immutable after creation.
- Blind line submission (private/simultaneous), reveal, trimmed mean (reuses Phase 0
  pure fn), 30-min challenge window, 50%+ dispute → resubmit loop.
- Scheduling engine (§2.4) introduced here for the challenge window timer.
- **Acceptance:** blind submissions hidden until reveal; trimmed mean correct; challenge
  window auto-advances; dispute loop repeats correctly.

### Phase 5 — Staking + parimutuel odds (spec §4, build-order 5)
**Goal:** upfront staking window, caps, refunds, locked odds.
- Staking window timers (1h/24h/48h) + 30-min warning. Min $1, 5× relative cap with
  auto-refund of excess, void if one-sided or empty. Escrow holds via `EscrowService`.
- Odds computed once at window close (reuses Phase 0 parimutuel fn), locked.
- **Acceptance:** cap excess refunded before odds; one-sided/empty → auto-void + refunds;
  odds match shared-math tests; staked funds correctly held in escrow ledger.

### Phase 6 — Verification engine (spec §6, build-order 6)
**Goal:** per-event 50% voting + 50/50 tiebreaker re-vote.
- Queue update (staker or subject only; non-stakers & mid-bet joiners blocked). 50%
  verify/deny. 50/50 → 30-min re-vote window → majority or default deny; resubmit allowed.
- Running line updated on verified events.
- **Acceptance:** voting eligibility enforced; tiebreaker window behaves per §6.2;
  verified events update the line.

### Phase 7 — Expiration, disputes & resolution (spec §5.2, §7, build-order 7)
**Goal:** soft expiration → 24h window → finalize.
- Soft expiration opens 24h window (+2h warning). No new queues after expiry; pending
  votes continue. Disputes: add-missed (70%) / remove-event (70%) with evidence.
- Auto-resolve at window close: numeric line vs set line; binary verified-ever logic.
  Refund conditions (§7.3). Payouts via parimutuel → ledger credits. Status pills.
- **Acceptance:** all bets wait full 24h; 70% dispute thresholds; correct
  resolve/void/payout end-to-end; unresolved dispute at close → full refund.

### Phase 8 — Cancellation (spec §8, build-order 8)
**Goal:** creator unilateral cancel + 50% member cancel vote.
- Cancel at any lifecycle point; immediate refunds to wallets; irreversible.
- **Acceptance:** both cancel paths refund all stakers fully via ledger; irreversible.

### Phase 9 — Realtime + Chat (spec §6.3, build-order 9)
**Goal:** live updates + Stream chat (circle-level + bet-level).
- Socket.io: live odds, verification alerts, status changes. `ChatProvider` abstraction
  over Stream (free dev tier). Media evidence: client compress, cap video 15s (§15).
- **Shareable invite links (deferred from Phase 3):** Creator generates a short-lived
  invite token embedded in a deep link (e.g. `wager://join/{token}`). Anyone with the
  link is **auto-approved** on use — sharing the link is implicit consent. Needs Expo
  deep link config (URL scheme, Apple Associated Domains, Android App Links) so it must
  be built alongside the mobile frontend, not backend-only. Backend: `CircleInviteToken`
  table + `POST /circles/:id/invite-link` (generate/revoke) + `POST /circles/join/:token`
  (consume). Frontend: handle the incoming URL and navigate to the join confirmation screen.
- **Acceptance:** two devices see live verification/odds updates; chat works at both
  levels; media uploads under cap; invite link opens the app and joins the circle in one tap.

### Phase 10 — Notifications (spec §11, build-order 10–11)
**Goal:** Expo push + full preference matrix + settings UI.
- Expo Push tokens; 5 categories × triggers; default ON/OFF per spec; settings screen.
- Hook all lifecycle/verification/dispute/circle/payment events to notifications.
- **Acceptance:** each spec trigger fires; defaults correct; toggles respected.

### Phase 11 — Profile, feed & full UI pass (spec §12–13)
**Goal:** the 4-tab app, dark/mint design system, all screens.
- Design tokens (`#0F0F0F`/`#1A1A1A`/`#3DFFC0` + status colors). 4-tab nav (Feed,
  Circles, Alerts, Profile). Feed by urgency; balance card; circle inner tabs; bet cards
  with status pill/odds/pot/verification banners; profile stats + bet history filters.
- **Acceptance:** every spec screen present and wired to live data; design tokens applied.

### Phase 12 — Hardening & test coverage
**Goal:** end-to-end confidence before money is real.
- E2E tests of full bet lifecycles (numeric & binary, incl. ties, disputes, voids,
  cancels). Load-test odds/escrow under concurrent stakes. Security pass (authz on every
  endpoint, idempotency, rate limits on OTP).
- **Acceptance:** green E2E suite for all lifecycle paths; ledger reconciles to zero
  across a full simulated season.

### Phase 13 — Deploy (still virtual money)
**Goal:** live app, real users, real engagement data — virtual currency (per §16).
- Deploy API to Railway/Render; managed Postgres/Redis; Expo build via EAS (Apple $99,
  Google $25). Monitoring/error tracking. Budget expands here.
- **Acceptance:** installable build; production smoke tests pass; onboarding states real
  fees are coming (§7.4).

### Phase 14 — Real-money switch (spec §10, build-order 12–13) — *gated on legal*
**Goal:** plug in Stripe; nothing else changes.
- Implement `StripeConnectProvider` (Payment Intents, ACH+Plaid, Connect Payouts),
  webhooks, real `Transaction` reconciliation, KYC. Optional 2% rake (§7.4). Flip
  `MONEY_MODE=real`. Compliance/licensing per §16 with counsel.
- **Acceptance:** real deposit→stake→payout→withdraw round-trips reconcile; game logic
  diff vs virtual = zero.

---

## 6. Cross-cutting concerns

- **Testing strategy:** pure logic = exhaustive unit + property tests (`shared`); services
  = integration tests against a test DB; lifecycles = E2E. The spec's worked examples are
  encoded as fixtures.
- **Idempotency & concurrency:** all money endpoints take idempotency keys; escrow uses
  row-level locks / transactional guards; state transitions guarded by current status.
- **Observability:** structured logs from day one; error tracking added at deploy.
- **Security:** authz check on every endpoint (membership/staker eligibility), OTP rate
  limiting, no client-trusted money math, secrets only in `.env`.

## 7. Cost plan

- **Dev/testing:** Neon free, Upstash free, Clerk free, Stream free dev, Expo free, SMS
  stubbed, payments virtual → ~$0/month.
- **Deploy (virtual money):** Railway/Render hobby + managed DB + Apple $99/yr + Google
  $25 + domain ~$15/yr → spec's ~$35–60/mo dev / ~$450–550 early traction.
- **Real money:** Stripe/Plaid per-transaction fees + legal $5k–20k+ (§15–16).

## 8. Top risks & mitigations

| Risk | Mitigation |
|---|---|
| Financial bugs (double-pay, lost funds) | Append-only ledger, idempotency, property tests, reconcile-to-zero invariant |
| Timer/state races (windows) | Durable Postgres job table, idempotent guarded transitions |
| Real-money retrofit pain | Abstractions + real-money-ready schema built in Phase 1 |
| Legal exposure | Virtual currency until funded + counsel (§16) |
| Two-device drift | Shared cloud dev DB, everything in git, `.env.example` + `SETUP.md` |
| Cost surprises (Stream/S3) | Free tiers in dev; 15s video cap + client compression |

## 9. Tracking

Each phase is checked off only when its **acceptance criteria** pass. Update the status
line at the top and tick the box when done.

- [x] Phase 0 — Foundations & scaffolding  *(ESLint/Prettier lint tooling deferred to Phase 12)*
- [x] Phase 1 — Data model & money ledger  *(wallet/ledger live; circles/bets schema follow in their phases)*
- [x] Phase 2 — Auth & accounts
- [x] Phase 3 — Circles
- [x] Phase 4 — Bet creation + line setting
- [x] Phase 5 — Staking + parimutuel odds
- [ ] Phase 6 — Verification engine
- [ ] Phase 7 — Expiration, disputes & resolution
- [ ] Phase 8 — Cancellation
- [ ] Phase 9 — Realtime + chat
- [ ] Phase 10 — Notifications
- [ ] Phase 11 — Profile, feed & UI
- [ ] Phase 12 — Hardening
- [ ] Phase 13 — Deploy (virtual)
- [ ] Phase 14 — Real-money switch
