// Unit tests for AbetAgent: pure agent logic, no server, no DB, no LLM.
// Only no-DB branches of callTool are exercised here; DB-backed paths are
// covered by the :3400 smoke flows. Run: npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../../src/lib/knowledge";
import { readGuardrails, heuristicReply } from "../../src/lib/runner";
import { callTool, BUILTIN_TOOLS } from "../../src/lib/tools";
import { asRecord, asInputJson } from "../../src/lib/json";

describe("tokenize", () => {
  it("lowercases, drops stopwords and short tokens, dedupes", () => {
    assert.deepEqual(tokenize("The Refund POLICY policy is HERE for you"), ["refund", "policy"]);
  });

  it("returns [] for stopword-only or empty input", () => {
    assert.deepEqual(tokenize("what is the"), []);
    assert.deepEqual(tokenize(""), []);
  });
});

describe("readGuardrails", () => {
  it("tolerates non-objects", () => {
    assert.deepEqual(readGuardrails(null), {});
    assert.deepEqual(readGuardrails("human"), {});
    assert.deepEqual(readGuardrails(["human"]), {});
  });

  it("keeps valid fields and drops junk types", () => {
    assert.deepEqual(readGuardrails({ maxSteps: 3, escalateOn: ["human", 42, "cancel"], other: true }), {
      maxSteps: 3,
      escalateOn: ["human", "cancel"],
    });
    assert.deepEqual(readGuardrails({ maxSteps: "many" }), { maxSteps: undefined, escalateOn: undefined });
  });
});

describe("heuristicReply", () => {
  it("hands to a human instead of guessing when nothing matched", () => {
    const reply = heuristicReply("how do I time travel", []);
    assert.match(reply, /human/i);
    assert.doesNotMatch(reply, /time travel/i);
  });

  it("answers from the first hit and cites every source", () => {
    const reply = heuristicReply("refunds?", [
      { documentTitle: "Refunds", text: "Refunds land in 5 days. No exceptions." },
      { documentTitle: "Shipping", text: "Ships in 2 days." },
    ]);
    assert.match(reply, /Refunds land in 5 days/);
    assert.match(reply, /\[1\] Refunds/);
    assert.match(reply, /\[2\] Shipping/);
  });
});

describe("asRecord / asInputJson", () => {
  it("passes objects through and neutralizes the rest", () => {
    const obj = { a: 1 };
    assert.equal(asRecord(obj), obj);
    assert.deepEqual(asRecord([1]), {});
    assert.deepEqual(asRecord(null), {});
    assert.deepEqual(asRecord("x"), {});
  });

  it("asInputJson is an identity view", () => {
    const v = { steps: [1] };
    assert.equal(asInputJson(v), v);
  });
});

describe("BUILTIN_TOOLS", () => {
  it("declares exactly the in-process builtins", () => {
    assert.deepEqual([...BUILTIN_TOOLS], ["kb_search", "http_fetch", "escalate_to_human"]);
  });
});

describe("callTool (no-DB branches)", () => {
  const ctx = { workspaceId: "w", knowledgeBaseId: null as string | null, runId: "r" };

  it("refuses tools outside the agent's allow-list", async () => {
    const res = await callTool("kb_search", { query: "x" }, ctx, ["http_fetch"]);
    assert.equal(res.ok, false);
    assert.match(res.output, /not enabled/);
  });

  it("rejects non-http fetch URLs without touching the network", async () => {
    const res = await callTool("http_fetch", { url: "ftp://x/y" }, ctx, ["http_fetch"]);
    assert.equal(res.ok, false);
    assert.match(res.output, /http\(s\) URL/);
  });

  it("fails honestly on unreachable hosts", async () => {
    const res = await callTool("http_fetch", { url: "https://no-such-host.invalid/" }, ctx, ["http_fetch"]);
    assert.equal(res.ok, false);
    assert.match(res.output, /Fetch failed/);
  });

  it("escalates with a reason, or a sane default", async () => {
    const withReason = await callTool("escalate_to_human", { reason: "VIP caller" }, ctx, ["escalate_to_human"]);
    assert.equal(withReason.ok, true);
    assert.match(withReason.output, /VIP caller/);
    const def = await callTool("escalate_to_human", {}, ctx, ["escalate_to_human"]);
    assert.match(def.output, /needs a human/);
  });

  it("requires a query for kb_search", async () => {
    const res = await callTool("kb_search", { query: "  " }, ctx, ["kb_search"]);
    assert.equal(res.ok, false);
    assert.match(res.output, /needs a query/);
  });
});
