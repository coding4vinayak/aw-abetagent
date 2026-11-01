// Outbound webhooks, pinned where their rot is visible: the source.
//
// The failure mode being guarded is silence, not a crash. A declared event
// with no emitter, an emitter that slipped ahead of the row that made the
// state true, a delivery that lost its egress check or one of its two
// signatures, a webhook tool that dropped the generic spelling — each still
// typechecks, still builds, and still passes every runtime test that does not
// know to look. A source-reading test is the one that looks: the menu comes
// from `lib/webhooks.ts` itself, the emissions from `runner.ts`, and the
// assertions below are the contract the README documents, so drift between
// the two is a failing test rather than a support ticket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const sender = source("../../src/lib/webhooks.ts");
const runner = source("../../src/lib/runner.ts");
const tools = source("../../src/lib/tools.ts");
const listRoute = source("../../src/app/api/webhooks/route.ts");
const idRoute = source("../../src/app/api/webhooks/[id]/route.ts");

const declared = sender.match(/WEBHOOK_EVENTS = \[([^\]]+)\]/)?.[1] ?? "";
const menu = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test("the menu is exactly the three endings, in the order the docs list them", () => {
  assert.deepEqual(menu, ["run.completed", "run.escalated", "run.failed"]);
});

test("every terminal status maps to a declared event, one announce per ending", () => {
  assert.match(runner, /COMPLETED: "run\.completed"/);
  assert.match(runner, /ESCALATED: "run\.escalated"/);
  assert.match(runner, /FAILED: "run\.failed"/);
  for (const event of menu) {
    assert.ok(runner.includes(`"${event}"`), `no emitter for ${event} in runner.ts`);
  }
  assert.equal(
    (runner.match(/announce\(run, "/g) ?? []).length,
    6,
    "four escalation paths (phrase rule, no-confidence / no-sources, model handoff, step budget), the completion path and the catch",
  );
});

test("every announce sits after the write that makes the state true", () => {
  const calls = [...runner.matchAll(/announce\(run, "/g)].map((m) => m.index ?? 0);
  assert.equal(calls.length, 6);
  for (const at of calls) {
    const write = runner.lastIndexOf("prisma.run.update(", at);
    assert.ok(write !== -1, "an announcement with no row behind it");
    assert.ok(at - write < 400, "the terminal row is committed before the event about it");
  }
});

test("the no-confidence refusal is a real escalation, not a completed promise", () => {
  // The reply text says a teammate will pick this up; if the run ended
  // COMPLETED under run.completed, nothing would ever notify that teammate.
  assert.match(runner, /if \(hits\.length === 0\)/);
  assert.match(runner, /"no-confidence"/);
  assert.match(
    runner,
    /data: \{ status: "ESCALATED", output: refusal, completedAt \}/,
    "the refusal row is written ESCALATED with the customer-facing text preserved",
  );
  assert.ok(
    runner.indexOf('announce(run, "ESCALATED", { output: refusal }') > runner.indexOf("if (hits.length === 0)"),
    "the escalation event is announced from inside the no-confidence branch",
  );
});

test("an agent without kb_search cannot cite: no retrieval step, no reply", () => {
  assert.match(runner, /const canSearch = allowedTools\.includes\("kb_search"\)/);
  assert.match(runner, /"no-sources"/);
  assert.match(
    runner,
    /const hits = canSearch \? await searchKnowledge\(run\.workspaceId, null, run\.input, 3\) : \[\]/,
    "with no search tool there is nothing to hit and nothing to cite",
  );
});

test("a drafting model that declines is a real escalation, not a completed promise", () => {
  assert.match(runner, /export function isHandoffReply/);
  assert.match(runner, /reply with exactly: ESCALATE/, "the prompt must ask for the marker the runner checks");
  assert.match(runner, /"model-handoff"/);
});

test("the step budget is checked before the model is paid for a draft", () => {
  const budget = runner.indexOf('"step-budget"');
  const draft = runner.indexOf("await llmReply(");
  assert.ok(budget !== -1 && draft !== -1, "both sites must exist");
  assert.ok(budget < draft, "a budget-exhausted run must not have called the model");
});

test("the dispatcher signs the body once, under both spellings", () => {
  assert.match(sender, /createHmac\("sha256", secret\)\.update\(body\)\.digest\("hex"\)/);
  assert.match(sender, /"X-Abetagent-Signature": signature,/);
  assert.match(sender, /"X-Webhook-Signature": `sha256=\$\{signature\}`,/);
  assert.match(sender, /id: `evt_\$\{crypto\.randomBytes/, "the payload id is evt_-prefixed so a receiver can deduplicate");
  assert.match(sender, /"X-Webhook-Timestamp": String\(Date\.now\(\)\)/,
    "freshness: nuCRM's plugin receiver enforces the 5-minute window only when this header is present");
  assert.match(sender, /"X-Webhook-Delivery": payload\.id/,
    "the id inside the signed body — the value a receiver can dedupe on and a replayer cannot refresh");
});

test("every delivery passes the egress check immediately above its fetch", () => {
  const check = sender.indexOf('await assertAllowedTarget(rawUrl, "url")');
  const fetchAt = sender.indexOf("await fetch(rawUrl");
  assert.ok(check !== -1 && fetchAt !== -1);
  assert.ok(check < fetchAt && fetchAt - check < 200);
  assert.ok(sender.includes("AbortSignal.timeout(5000)"));
  assert.match(sender, /await Promise\.allSettled\(matching\.map/);
  assert.match(sender, /catch \(error\) \{\s*console\.error\(/);
});

test("webhook tool calls carry the generic body-only spelling too", () => {
  assert.match(tools, /headers\["x-abetagent-signature"\] = createHmac\("sha256", secret\)/, "the family, timestamped spelling stays");
  assert.match(tools, /\.update\(`\$\{timestamp\}\.\$\{body\}`\)/, "and it still covers the timestamp");
  assert.match(
    tools,
    /headers\["x-webhook-signature"\] = `sha256=\$\{createHmac\("sha256", secret\)\.update\(body\)\.digest\("hex"\)\}`/,
    "the generic spelling is the body-only digest nuCRM verifies",
  );
  assert.ok(
    !/headers\["x-webhook-timestamp"\]/.test(tools),
    "freshness must stay opt-in on the receiver side; sending a timestamp would make it mandatory",
  );
});

test("subscription writes refuse an unknown event and an internal destination", () => {
  assert.match(listRoute, /unknownEventsProblem\(events\.values\)/);
  assert.match(idRoute, /unknownEventsProblem\(events\.values\)/);
  assert.match(listRoute, /classifyTarget\(input\.data\.url, "url"\)/);
  assert.match(idRoute, /classifyTarget\(input\.data\.url, "url"\)/);
});

test("read responses preview the secret; only the create response carries it", () => {
  assert.match(sender, /export function webhookPreview/);
  assert.match(listRoute, /webhooks\.map\(webhookPreview\)/);
  assert.match(idRoute, /webhookPreview\(webhook\)/);
});

test("the subscription routes authenticate as the house pattern", () => {
  assert.match(listRoute, /await authedWorkspaceId\(request, body\.workspaceId\)/, "POST authenticates the body's workspace");
  assert.match(idRoute, /await assertOwns\(request, _owned\.workspaceId\)/);
});
