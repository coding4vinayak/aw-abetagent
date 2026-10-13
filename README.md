# AbetAgent

![CI](https://github.com/coding4vinayak/aw-abetagent/actions/workflows/ci.yml/badge.svg)


Autonomous AI agents for revenue and service. Agents that finish the job,
not just chat about it — $99/month.

Define an agent with a system prompt, an allowlisted tool set and
guardrails. Give it a knowledge base of your approved sources. Start a run:
it retrieves, reasons in a visible step trace, answers with citations — and
escalates to a human instead of bluffing when the answer is not there.

## Quick start

```bash
npm install
npx prisma migrate dev      # creates the SQLite database
npm run db:seed             # demo workspace, handbook KB, support agent, sample run
npm run dev                 # http://localhost:3400
```

`npm run test` runs the engine unit tests with no server and no database.

## The engine

Heuristic-first: keyword retrieval over your own documents plus a
deterministic replyer. Set `LLM_API_KEY` (any OpenAI-compatible endpoint)
and a model takes over drafting with the heuristic result as fallback — a
run never fails just because a model is down.

Guardrails that mean something: `escalateOn` phrases end the run with a
handoff instead of an answer, and a step budget stops runaway loops naming
the node it stopped at. The step trace (`THINK → TOOL_CALL → TOOL_RESULT
→ REPLY / ESCALATE`) is the audit trail: replay exactly what the agent saw
and did.

## Accounts (browser)

Machine callers authenticate with an API key above. Humans sign in:

```
GET  /login                # sign in
POST /signup               # create a workspace and an account
GET  /dashboard            # your own workspace (needs the session cookie)
GET  /members              # seats, invites, roles (owner/admin)
GET  /invite/{token}       # accept a one-time invitation link
```

A signup mints a `User` and a `Workspace` in one transaction and drops the
browser straight into it. Passwords are scrypt with the work factor recorded
beside the digest, so the cost can be raised later without invalidating anyone.
The session cookie holds a random 32-byte token and the database keeps only its
sha256; it is httpOnly, sameSite=lax, and `secure` outside development.

`?workspace=demo` stays public on purpose — it is what the landing pages link to
and what a prospect evaluates. Every other workspace requires the session that
owns it: naming someone else's slug is refused rather than served, and an
anonymous visitor is pointed at the login form instead of the data.

Sign-in is rate-limited per address (10 failures, 15-minute lock) and signup to
5 workspaces, so one client cannot grind through a list of accounts. Failed
logins take the same time whether or not the address exists.

A brand-new account has no API key, so the dashboard offers to mint one and
shows it exactly once — only a hash is stored. The prompt is scoped to
signed-in workspaces: a stranger on the public demo is never nagged to sign up.
It is a server action rather than a `POST /api/keys` call so the plaintext goes
straight into the page and never into a URL, a referrer, or an access log.

### Password reset and email verification

```
GET  /forgot-password             # request a reset link
GET  /reset-password?token=       # choose a new password
GET  /verify-email?token=         # confirm the address
```

Both links are **POST-only**: the page reads the token, the button redeems it. A
GET that changes state is triggered by link previewers, chat clients and
corporate scanners, so a single Slack unfurl would spend the token before the
person read it.

Tokens are stored hashed (sha256), single-use, and expired — reset in 1 hour,
verification in 24. Issuing a new one deletes the previous, so a link forwarded
last year stops working the moment a fresh one is requested. Reset requests are
rate limited to 3 per address per hour.

Redeeming a reset also **destroys every session on that account**. A password
change that leaves old cookies working evicts nobody, which defeats the entire
point of resetting. The same gap existed in abetConnect and is fixed there too.

The request endpoint answers identically whether or not the address has an
account — a "no such user" there is a customer enumeration oracle.

### Email delivery is honest about itself

`send()` returns which transport actually ran, and the UI says so:

| State | Behaviour |
|---|---|
| `RESEND_API_KEY` or `EMAIL_WEBHOOK_URL` set | Message is delivered; verification is enforced at sign-in |
| Neither set | Link is written to the server log, and the page says plainly that nothing was sent |

An account created with no provider configured starts **pre-verified**, because
enforcing a click on a message that can never arrive would lock the account out
of its own product. With a provider set, sign-up starts unverified, sends the
link, and `signIn` refuses until it is confirmed. A provider outage at
verification is swallowed deliberately — the account exists, and the link can be
re-sent from the dashboard — because failing signup after the row is written
would leave an account nobody can reach.

No new dependency: the HTTP sender is `fetch` only, and `setEmailSender()`
accepts SMTP, SES or anything else without touching a route.

### Teams

Anyone with an account belongs to one or more workspaces, each with a role:
`OWNER` (created at signup, never issuable by invite), `ADMIN`, or `MEMBER`.
Owners and admins invite by email from `/members`; the link is single-use,
expires in 7 days, names one address, and is shown once because only its hash
is stored. Re-inviting rotates the old link dead. Accepting moves the browser
into the new workspace. Removing a seat destroys that person's sessions in it
immediately — revoking access and leaving the cookie working would be the same
mistake twice. The dashboard bar lists every workspace the account can open.

An admin can invite members but cannot mint another admin; only an owner can.
A member cannot invite, see keys, or change seats. Ownership never transfers
through the invite path — that is a decision, not a missing feature.

Set `SESSION_COOKIE` if several of these products ever share one hostname, so
their cookies stay apart. It defaults to `abetworks_session`, which is safe as
long as each product has its own database — a token from one is simply not found
in another's session table.

This file's provenance: the auth surface shipped as one source, byte-copied across six
apps during the Abetworks campaign. The vendoring scripts and drift gate that enforced
identity are retired. This app's copy is its own and can evolve independently.
Full context: `abetworks-history` §8.20 and §8.44.

## Authentication

Every management route is workspace-scoped and requires an API key. A browser session is the other half — see [Accounts](#accounts-browser). `workspaceId`
in the query or body is **checked against the key** — a mismatch is a `403`,
not a silent cross-tenant read.

```bash
# Mint a key for the demo workspace (side-effect free, mints a fresh key)
npm run seed:key            # prints the plaintext once

# Call anything
curl http://127.0.0.1:3400/api/agents?workspaceId=cmuapyuv90000niql0l1zvi9p \
  -H "Authorization: Bearer <paste-key>"
```

Keys are prefixed `aa_live_` so a leaked one is self-identifying. Only a sha256
hash is stored; the plaintext is shown once and cannot be recovered.

| Response | Meaning |
|---|---|
| `401` | No key, unknown key, or a revoked key |
| `403` | Valid key, but that `workspaceId` is not its workspace |

Deliberately **not** key-gated: `GET /api/health`, the provider inbound
webhook receivers (Twilio/WhatsApp/LinkedIn — they authenticate by their own
protocol), and `POST /api/billing/webhook` (Stripe signature).

## API

All routes below need the key from [Authentication](#authentication) —
the snippets omit the header for width.

```
GET    /api/health                         # liveness + DB ping, no key
GET    /api/agents?workspaceId=            # list
POST   /api/agents                         # create (tools validated against registry)
GET    /api/agents/{id}                    # detail + recent runs
PATCH  /api/agents/{id}                    # edit
DELETE /api/agents/{id}
GET    /api/agents/{id}/runs               # list with step traces
POST   /api/agents/{id}/runs               # start (sync=true waits for the answer)
GET    /api/runs/{id}                      # full trace
DELETE /api/runs/{id}
GET    /api/tools?workspaceId=             # registry + builtins
POST   /api/tools                          # webhook tools only (builtins need no row)
GET    /api/knowledge?workspaceId=         # bases, or ?q= to search
POST   /api/knowledge                      # create a base, or ingest a document
```

Builtins: `kb_search` (your documents, cited), `http_fetch` (10s timeout,
4KB cap, http(s) only), `escalate_to_human`. Webhook tools POST signed
JSON (`timestamp.body` HMAC) with a 10s timeout.

## Billing

$99/month flat via Stripe. Three endpoints under `/api/billing` (workspaceId as query param, no session in this app):

POST /api/billing/checkout
POST /api/billing/portal
POST /api/billing/webhook

`checkout` takes `{ priceId: "FLAT_MONTHLY" | "FLAT_ANNUAL", returnUrl }` and returns `{ url }` for the Stripe-hosted page. A workspace the `Subscription` row says is already trialing, active or past due gets a 409 instead of a second checkout: another session would be another subscription, and nothing cancels the one Stripe is already charging, so a plan switch or a fixed card is the portal's job. The webhook verifies the Stripe signature and syncs `checkout.session.completed`, `customer.subscription.*`, and `invoice.payment_failed` into the `Subscription` row. Setup: create the two prices in Stripe, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FLAT_MONTHLY`, `STRIPE_PRICE_FLAT_ANNUAL`, forward webhooks with `stripe listen --forward-to localhost:3400/api/billing/webhook`. Signature checks are unit-tested offline in `tests/unit/billing.test.ts`.

Every paid plan opens with a 14-day card-up trial (`trial_period_days` on the subscription), so the first invoice is dated two weeks out and the dashboard banner counts the days down to it. Two warnings are armed off the webhook that confirms the trial — delayed BullMQ jobs on `abetagent-billing`, at three days left and one day left — and each one re-reads the `Subscription` row before it mails: a workspace that already converted, cancelled, or had its trial moved gets silence rather than a wrong date. Arming is best-effort in the same shape as every other mail here, so with Redis down the webhook still answers 200 and no nudge is sent; `REDIS_URL` has to point somewhere real for these to arrive. The job id names the trial period, so a Stripe webhook retry cannot double-send. A cancellation is answered the same way: `customer.subscription.deleted` arms a confirmation (no further charge, nothing deleted) and one win-back mail seven days later, both on the same `-billing` queue. Those two are keyed on the Stripe subscription id rather than the workspace, because a subscription is deleted exactly once — a re-delivered event cannot double-send, while a buyer who comes back and leaves again is a new subscription and gets a new pair. Each mails only if the row still says `canceled` *for that subscription id*: a workspace that returned is not a churn risk, and telling a paying customer they are gone is worse than saying nothing. Every billing mail that has to go looking for a person — dunning, conversion, nudge, cancellation, win-back — is addressed by the same `ownerOf` query: the oldest `OWNER` membership, which is the account that ran checkout. Not the Stripe customer, which `ensureCustomer` creates with an empty email. The receipt is the exception, and a good one: its address is the one the buyer typed into the checkout page, so it needs no lookup. The conversion mail is the one that fails quietly, inside a `try`/`catch` that logs: by the time it would be sent the sync has already overwritten the status that made the transition visible, so the retry a non-200 buys has nothing left to announce — a loud failure there deletes the mail rather than delaying it. A declined-payment notice keeps the opposite shape, because nothing is consumed by sending it: if the lookup fails the webhook fails, and Stripe's retry delivers the mail.

## Putting it somewhere

```bash
npm ci
npm run db:deploy
npm run build
npm start
```

Point the load balancer at `GET /api/health` (200 = serving, 503 = DB down).
Queue workers (`src/lib/queue.ts`, BullMQ + Redis) drain the `abetagent-runs`
and `abetagent-billing` queues. The product is in the name because a BullMQ queue name *is* its Redis key
prefix: while this and abetflow's were both `runs`, the two apps' workers took
each other's jobs. The separator is a hyphen because bullmq rejects a `:` in a
queue name outright. `sync=true` executes inline with no Redis at all. The Queue is
built on first touch rather than at import — constructing one connects to Redis even
on a `lazyConnect` client, so an import wrote `bull:abetagent-runs:meta` into db 0 and
left the test runner unable to exit. Every job it creates bounds its retention at
construction (`defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 }`): a
completed run has no reader — `GET /api/health` asks for `waiting`/`active`/`failed`
counts only (read from `src/app/api/health/route.ts`) and the run's durable record is
SQLite, not the queue — while a failed job is kept, capped, because its hash is the only
place its payload and stack survive. That is the leadgenius retention convention (#61)
ported family-wide (#64). `src/lib/shutdown.ts` drains it: Next 16.2.12
offers no shutdown hook (`InstrumentationModule` is `register` and `onRequestError`,
read from its own `.d.ts`), so `instrumentation.ts` installs SIGTERM/SIGINT handlers
in production and lets the workers' in-flight Redis setup land before closing
anything. For Postgres,
follow the same three steps as abetConnect: provider switch, fresh migration
history, regenerate.
