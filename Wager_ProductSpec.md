# Wager — Product Specification
**Version 1.0 · June 2026 · Confidential Draft**

---

## Table of Contents
1. [Vision](#1-vision)
2. [Core Concepts](#2-core-concepts)
3. [Line Setting](#3-line-setting-numeric-bets)
4. [Staking](#4-staking)
5. [Bet Timelines & Lifecycle](#5-bet-timelines--lifecycle)
6. [Verification System](#6-verification-system)
7. [Resolution & Disputes](#7-resolution--disputes)
8. [Cancellation Policy](#8-cancellation-policy)
9. [Authentication & Accounts](#9-authentication--accounts)
10. [Payments & Financials](#10-payments--financials)
11. [Notifications](#11-notifications)
12. [Profile & Settings](#12-profile--settings)
13. [UI & Design](#13-ui--design)
14. [Technology Stack](#14-technology-stack)
15. [Infrastructure Costs](#15-infrastructure-costs)
16. [Legal Considerations](#16-legal-considerations)
17. [Build Order](#17-build-order)

---

## 1. Vision

Wager is a social prediction market platform for friend groups. Friends come together in persistent circles and place real-money wagers on events from their everyday lives — exam scores, gym visits, personal challenges, and more.

The platform brings the fairness and mechanics of a professional prediction market (dynamic odds, peer-to-peer payouts, crowd-sourced line setting) to casual social contexts where trust and accountability already exist.

**The core insight:** friend groups make informal bets all the time. The current solution is Venmo IOUs that get forgotten or turn awkward. Wager gives that behavior proper infrastructure — a ledger, a rules engine, and a social layer — without losing the fun.

---

## 2. Core Concepts

### 2.1 Circles

A circle is the primary object of the platform. It is a persistent, invite-only group of friends. Bets are created within circles and only circle members can participate in those bets.

- Circles are long-term — a new circle is not required for every bet
- The circle creator must approve all new members before they can join
- Members can leave a circle at any time, as long as they are not an active participant in an ongoing bet
- Members can join a circle mid-bet but may not participate in or vote on any bets already in progress
- The circle creator cannot leave while any bet is active
- Multiple bets can run simultaneously within the same circle
- Any circle member can create a new bet

### 2.2 Bet Types

Wager supports two types of wagers:

**Numeric (Over/Under)**
- Members bet on whether a measurable outcome lands above or below a set line
- Requires a minimum of 4 circle members to run
- Example: will the group's average exam score be over or under 89.5?

**Yes/No (Binary)**
- Members bet on whether a specific event happens or not
- Requires a minimum of 2 circle members to run
- Example: will Maya finish the book by Sunday?

---

## 3. Line Setting (Numeric Bets)

To ensure the line is fair and not manipulated by a single person with an information advantage, Wager uses a blind auction with a trimmed mean.

### 3.1 The Process

1. All circle members privately and simultaneously submit what they believe the fair line should be
2. The platform drops the highest and lowest submissions and averages the remaining values (trimmed mean)
3. The resulting line is revealed to the circle
4. A **30-minute challenge window** opens — if 50%+ of the circle disputes the line, everyone resubmits and the process repeats
5. Once the line is accepted, the staking window opens

### 3.2 Why Trimmed Mean

The trimmed mean prevents a single outlier — accidental or malicious — from skewing the line. It works naturally with both small circles (4 people) and large circles (50+ people), making it the most robust line-setting mechanism across all group sizes.

---

## 4. Staking

### 4.1 Upfront Staking Window

All staking happens upfront during a defined window before the bet begins. This eliminates varying odds during the bet and keeps the mechanics simple and fair. Odds are calculated once after the staking window closes and locked for the full duration of the bet.

| Bet Duration | Staking Window |
|---|---|
| 1 Day | 1 Hour |
| 1 Week | 24 Hours |
| 1 Month | 48 Hours |

### 4.2 Stake Limits

- **Minimum stake:** $1 per person per bet
- **No hard maximum**, but a relative cap applies
- **Relative cap:** no single person can stake more than 5x the lowest staker in that bet
- Excess above the cap is automatically refunded before odds are calculated
- If only one side has stakers when the window closes, the bet is voided and all stakes are refunded
- If the staking window closes with zero stakes from anyone, the bet is automatically voided and the circle is notified

### 4.3 Odds System — Parimutuel

Wager uses a parimutuel system. There are no fixed odds. The total pot from the losing side is distributed proportionally to winners based on each winner's stake relative to their side's total pool.

**Example — line is 3.5 meals per day:**
- Over pool: Jake $50, Sarah $20, Mike $10 → total $80
- Under pool: John $30, Lisa $30 → total $60
- **Under wins:** John gets 50% of $80 = $40 winnings + $30 stake back = **$70 total**. Lisa gets the same.
- **Over wins:** Jake gets 62.5% of $60 = $37.50 winnings + $50 stake back = **$87.50 total**

The relative 5x cap ensures no single person dominates the proportional payout, keeping winnings meaningfully distributed across the group.

---

## 5. Bet Timelines & Lifecycle

### 5.1 Duration

The bet creator sets the duration at creation time. Three options:
- 1 Day
- 1 Week
- 1 Month

Bets are **not editable after creation** under any circumstances. The creator must cancel and remake if changes are needed.

### 5.2 Soft Expiration

Bet expiration is a soft close, not a hard cutoff. When a bet expires, a **24-hour post-expiration window** opens automatically. This window serves two purposes:
- Finalizing pending verifications queued before expiration
- Handling disputes

No new update submissions can be queued after expiration. The circle can continue voting on updates already queued before the deadline.

All bets — regardless of type or whether the line was crossed mid-bet — wait until the full 24-hour window closes before finalizing. This ensures no legitimate dispute is cut off by an early resolution.

### 5.3 Status Indicators

| Status | Meaning |
|---|---|
| 🟡 Bet Active | Updates are being submitted and verified |
| 🟠 Bet Closed | In the 24-hour post-expiration window |
| 🟢 Resolved | Outcome finalized, payouts processed |
| 🔴 Voided | Refunds issued to all stakers |

---

## 6. Verification System

### 6.1 How It Works

Every discrete event (a meal, a gym visit, a submitted score) requires its own verification before it is added to the running line.

- Any member who staked on the bet can queue an update submission while the bet is active
- The subject of the bet can queue their own updates
- Members who did not stake cannot queue updates or vote on verifications
- Members who joined the circle after the bet started cannot participate in verification
- **50% of staked members must vote to verify** for the update to be added to the line
- 50% voting to deny rejects the submission

### 6.2 The 50/50 Tiebreaker

If a verification vote ends exactly 50/50:

1. A **30-minute re-vote window** opens
2. Circle is notified the vote is tied — discussion is encouraged in the bet chat
3. Any member can change their vote during the window
4. If the tie is broken during the window, the majority outcome applies
5. If still tied after 30 minutes, the submission is **denied by default**
6. The submitter can post new evidence in the bet chat and resubmit the same event as a new verification queue entry at any time while the bet is still active

### 6.3 Evidence & Chat

Evidence is social persuasion, not a technical requirement. The platform does not enforce a specific evidence format — the circle decides collectively through voting.

- Each bet has a dedicated **bet chat** where members can submit photos, videos, and messages to support or challenge a verification
- Each circle also has a **general circle chat** for ongoing banter and discussion
- Verification is determined purely by the 50% vote, not by whether evidence was provided

---

## 7. Resolution & Disputes

### 7.1 Resolution Rules

All bets wait until the full 24-hour post-expiration window closes before finalizing.

- **Numeric bets:** the final verified line is compared to the set line after the window closes. Over or Under pays out accordingly
- **Yes/No bets:** Yes pays out if the event was verified at any point. No pays out if the event was never verified

### 7.2 Dispute Mechanics

During the 24-hour window, staked members can raise two types of disputes:

**Add a missed event**
- Any staked member can flag that an event occurred but was never submitted during the active period
- Evidence must be provided in the bet chat
- **70% of staked members must confirm** to add the event to the line

**Remove a disputed event**
- Any staked member can challenge an already-verified event they believe was incorrectly approved
- Counter-evidence must be provided in the bet chat
- **70% of staked members must confirm** to remove the event from the line

Both dispute types require a higher threshold (70% vs 50%) to reflect the additional scrutiny applied to contested events.

### 7.3 Refund Conditions

A full refund is issued to all stakers in the following situations:
- Any dispute remains unresolved when the 24-hour window closes
- Only one side had stakers when the staking window closed
- Staking window closed with zero stakes from anyone
- Bet was cancelled by the creator or by member vote

### 7.4 Revenue Rake (Future)

- v1 launches with **zero rake** — the platform takes no cut
- Onboarding will transparently communicate that a small platform fee will be introduced in the future
- When introduced, the rake will be **2% of the losing pool** before winnings are distributed
- The rake will be shown clearly at bet creation so users know upfront

---

## 8. Cancellation Policy

### 8.1 Who Can Cancel

- **Bet creator** can cancel at any time unilaterally
- **Any staked member** can initiate a cancellation vote
- If 50%+ of staked members vote to cancel, the bet is cancelled

### 8.2 Cancellation Rules

- A bet can be cancelled at any point in its lifecycle
- On cancellation, all stakes are returned to everyone's in-app wallet immediately
- No partial refunds, no fees deducted on cancellation
- Cancellation is irreversible

---

## 9. Authentication & Accounts

### 9.1 Account Creation

Three signup methods are supported:

- **Google Sign In**
- **Apple Sign In**
- **Email + Password**

After account creation via any method, the user is prompted to verify their phone number via **SMS OTP** before the account is fully activated.

### 9.2 Phone Verification Rules

- SMS OTP is sent to the user's entered phone number
- OTP expires after 10 minutes
- Maximum 3 failed attempts before a cooldown period
- **One phone number per account globally** — if a number is already tied to an existing account, signup is blocked and the user is notified
- Phone number cannot be changed after verification
- Phone number is not used for login — only for initial verification and account recovery

### 9.3 Login (Returning Users)

- Google — one tap
- Apple — one tap
- Email — email + password
- Phone number is not a login method

### 9.4 Account Recovery

- Google and Apple handle their own recovery flows
- Email users can reset password via email link
- Phone number serves as a secondary recovery option

### 9.5 Account Deletion Policy

- Cannot delete while holding an active bet stake
- Cannot delete while holding a positive in-app balance — must withdraw first
- Cannot delete while circle creator — must transfer ownership first
- Personal data (name, phone number, profile info) wiped immediately upon deletion
- Bet history and chat messages anonymized and retained as "Deleted User" to preserve integrity of historical records
- Financial transaction records retained for 5 years per legal requirement
- Account is unrecoverable after deletion — user must explicitly confirm this
- Circle ownership transfers to the longest-standing member if the creator deletes without nominating a successor

---

## 10. Payments & Financials

### 10.1 In-App Wallet

Users deposit money into an in-app wallet and draw from that balance when staking. Winnings are automatically credited to the wallet after resolution.

### 10.2 Deposit Methods

| Method | Provider | Notes |
|---|---|---|
| Debit Card | Stripe Payment Intents | Instant, ~2.9% + $0.30 fee |
| ACH Bank Transfer | Stripe ACH Direct Debit + Plaid | 3–5 business days, $0.25 flat fee |
| Apple Pay | Stripe Payment Request Button API | Instant, same fee as debit |
| Google Pay | Stripe Payment Request Button API | Instant, same fee as debit |

### 10.3 Withdrawals

- Users can withdraw their in-app balance to a linked bank account at any time
- **Minimum withdrawal: $5**
- ACH bank transfer — 1–3 business days
- Instant payout to debit card available as a premium option (Stripe fee applies)
- Withdrawals processed via **Stripe Connect Payouts**

### 10.4 Payment Infrastructure

All payments route through **Stripe Connect**. Funds are held in escrow peer-to-peer rather than by the platform directly, reducing money transmission exposure.

- Stripe ACH Direct Debit + Plaid for bank account verification and ACH pulls
- Stripe Payment Intents for card and digital wallet deposits
- Stripe Connect Payouts for withdrawals
- In-app balance ledger tracked in PostgreSQL

---

## 11. Notifications

All notifications are optional and configurable in settings. Grouped into 5 categories, each with a master toggle and individual triggers.

**Default ON** — anything requiring user action or financial movement
**Default OFF** — passive confirmations the user didn't trigger

### 11.1 Bet Lifecycle
- Line submissions are open for a new numeric bet
- Line has been revealed, challenge window is open
- Challenge window passed, staking window is now open
- Staking window is closing soon (30 min warning)
- Staking window closed, odds are locked
- Bet is now active
- Bet has expired, dispute window is now open
- Dispute window closing soon (2 hour warning)
- Bet resolved — you won
- Bet resolved — you lost
- Bet voided — refunds issued

### 11.2 Verification
- A new verification has been queued, your vote is needed
- A verification vote is tied, re-vote window is open
- A verification was approved *(default off)*
- A verification was denied *(default off)*

### 11.3 Disputes
- A dispute has been raised, your vote is needed
- A dispute was resolved — event added
- A dispute was resolved — event removed

### 11.4 Circles
- Someone requested to join your circle *(creator only)*
- You have been approved to join a circle
- A new bet has been created in your circle *(default off)*
- A new member joined your circle *(default off)*

### 11.5 Payments
- Deposit successful
- Withdrawal initiated
- Withdrawal completed
- Payout received

---

## 12. Profile & Settings

### 12.1 Profile Screen

**Identity**
- Display name (editable)
- Profile picture (editable)
- Phone number (not editable)
- Member since date

**Stats**
- Total bets
- Win/loss record
- Total wagered
- Total won/lost
- Biggest win

**Financial**
- Current in-app balance
- Total deposited
- Total withdrawn
- Deposit and withdraw buttons

**Bet History**
- Scrollable list of all past bets across all circles
- Filterable by: won, lost, voided, cancelled

### 12.2 Notification Settings
- 5 category groups with master toggles
- Individual trigger toggles within each category
- Default states as defined in Section 11

---

## 13. UI & Design

### 13.1 Visual Language

- **Style:** dark and sleek — inspired by Robinhood and Polymarket
- **Accent color:** bright mint green `#3DFFC0`
- **Background:** near-black `#0F0F0F`
- **Card surfaces:** dark `#1A1A1A`
- **Status colors:**
  - 🟡 Active — mint green
  - 🟠 Staking — amber `#EF9F27`
  - 🔴 Dispute — red-tint `#F09595`
  - 🔵 Resolved — blue-tint `#85B7EB`

### 13.2 Navigation

4-tab bottom navigation bar, consistent across all screens:

| Tab | Purpose |
|---|---|
| Feed | Active bets across all circles, sorted by urgency |
| Circles | List of all circles the user belongs to |
| Alerts | Verification requests, dispute votes, resolutions |
| Profile | Personal stats, bet history, balance |

### 13.3 Circle View

- Circle name and bright mint **New Bet** button sit inline in the header
- New Bet button only appears on the circle screen — not in the global nav
- Inner tabs: Bets, Members, Chat, History
- Stat cards: active bet count, total pot, personal win/loss record
- Bet cards show status pill, line progress, live odds, pot size, and inline verification banners

### 13.4 Home Feed

- Active bets across all circles prioritized by urgency
- Pending verifications, closing staking windows, and open dispute windows surface first
- Balance card at top: total wagered, active bets, monthly P&L
- Something actionable visible every time the user opens the app

---

## 14. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React Native + Expo | iOS & Android from one codebase |
| Backend | Node.js + NestJS | Modular architecture maps to domain objects |
| Primary Database | PostgreSQL | Users, circles, bets, stakes, verifications |
| Cache / Realtime DB | Redis | Live odds, verification queues, notification state |
| Realtime Layer | Socket.io | Live odds updates, verification alerts, chat |
| Chat & Media | Stream | Photos, videos, messages with React Native SDK |
| Media Storage | AWS S3 + CloudFront | Evidence storage and fast CDN delivery |
| Authentication | Clerk | Google, Apple, email auth + SMS OTP via Twilio |
| Payments | Stripe Connect | Escrow, payouts, card/ACH/digital wallet |
| Push Notifications | Expo Push | Verification alerts, windows, resolutions |
| Hosting | Railway or Render | Production grade, simpler than AWS for early stage |

---

## 15. Infrastructure Costs

### Development Stage (~$35–60/month)
Most services have free tiers that cover early usage comfortably.

### Early Traction (~$450–550/month)
Stream becomes the primary cost driver as it scales with monthly active users.

### Growth Stage (~$2,000–5,000/month)
Driven by Stream at scale, backend compute for WebSocket connections, and AWS S3 egress. Recommend capping video evidence at 15 seconds and compressing on client before upload.

### Hidden Costs
- Apple Developer Program — $99/year
- Google Play — $25 one-time
- Legal fees — $5,000–20,000+ for real-money wagering compliance
- Domain + SSL — ~$15/year

### Fee Sustainability at Maturity (with rake)
- 2% rake on a $50 pot generates $1 revenue vs $0.25 ACH cost — net positive $0.75
- Rake covers debit card deposit fees at scale
- Platform net profitable on any pot above ~$15

---

## 16. Legal Considerations

Real-money wagering on uncertain outcomes between users is regulated in most U.S. jurisdictions.

- **Money transmission licensing** is required to hold and disburse user funds in most states — individual state licenses, surety bonds, and audits
- **Peer-to-peer wagering** on uncertain events may be classified as gambling under state law
- **Kalshi's 2024 CFTC legal win** opened new doors for prediction market legal arguments
- Using **Stripe Connect escrow** (peer-to-peer, not held by the platform) reduces money transmission exposure

### Recommended v1 Approach
Build the full product with virtual currency first. Design every screen as if real money is present. Get real users and engagement data. Raise funding on that traction, then tackle real-money licensing with proper legal counsel and capital.

---

## 17. Build Order

1. Auth — Google, Apple, email signup + SMS OTP phone verification (Clerk)
2. Circle creation, invite flow, and member approval
3. Bet creation flow — both numeric and yes/no types
4. Blind line setting mechanic — trimmed mean + challenge window
5. Staking window + parimutuel odds calculation
6. Verification queue + 50% voting system + tiebreaker re-vote
7. Dispute mechanic + 24-hour post-expiration window
8. Cancellation flow — creator unilateral + member vote
9. Chat via Stream — circle-level and bet-level
10. Push notifications via Expo
11. Profile screen + notification settings
12. In-app wallet + Stripe payment integration
13. Real-money payouts via Stripe Connect

---

*Wager — Confidential Product Specification · June 2026*
