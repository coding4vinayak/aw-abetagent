// N5: a wrong-typed field used to be the database's problem, and the database
// answered one of two ways — a validation error that leaves as a 500, or the
// value itself. Measured against this app's own dev.db, through the exported
// handlers, one body with exactly one wrong field each time:
//
//   POST  /api/agents        name: 42              500 PrismaClientValidationError
//   POST  /api/agents        model: 42             201, model "" — the value dropped
//   POST  /api/agents        tools: [42]           201, tools [] — filtered away
//   POST  /api/agents        guardrails: 42        201, a number in a Json column
//   POST  /api/agents        status: "PAUSEDX"     201, and every later run 409s
//   POST  /api/tools         isActive: "no"        201 with true stored — "no" too
//   PATCH /api/tools/:id     {}                   200 holding an unchanged row
//   POST  /api/knowledge     name: "   "           201, a base named with spaces
//   POST  /api/agents/:id/runs  sync: "yes"        202, queued instead of run inline
//   POST  any write route    no body at all        500 SyntaxError from request.json()
//
// These pin the engine's own contract, because every write route here is written
// against it. Each row was then replayed through the running app with the tables
// wired, and answers the 400 its own message names — 47 probes, 0 failures, the
// replay recorded in the commit that added this file. What pins the routes
// themselves against someone forgetting the next one is route-validation.test.ts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boolFlag,
  NO_FIELD_TO_UPDATE,
  readJson,
  validateBody,
  type Schema,
} from "../../src/lib/validate";
import { AGENT_CREATE, AGENT_PATCH, TOOL_PATCH } from "../../src/lib/fields";

const body = async (response: Response) =>
  (await response.json()) as { error: string; fields?: Record<string, string> };

const ONE = {
  name: { kind: "text", required: true, max: 20 },
  nickname: { kind: "text", nullable: true },
} satisfies Schema;

describe("a field the route did not declare is not a value it will write", () => {
  it("omits a key the body never mentioned, so PATCH cannot reset it", () => {
    const result = validateBody({ name: "kept" }, ONE);
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.data ?? {}), ["name"]);
    assert.equal("nickname" in (result.data ?? {}), false);
  });

  it("refuses a body that is not an object", () => {
    // Measured: `[]` reached the handler's destructuring, produced no keys, and
    // the route answered "name, systemPrompt required" to a client that had no
    // way to send them inside an array.
    for (const value of [null, 42, "name", ["a"]]) {
      const result = validateBody(value, ONE);
      assert.equal(result.ok, false, `${JSON.stringify(value)} should not pass`);
      assert.equal(result.error?.status, 400);
    }
  });

  it("names every field that is wrong, in one response", async () => {
    const result = validateBody({ name: 42, nickname: [] }, ONE);
    assert.equal(result.ok, false);
    const payload = await body(result.error!);
    assert.match(payload.error, /name must be text/);
    assert.match(payload.error, /nickname must be text/);
    assert.deepEqual(Object.keys(payload.fields ?? {}).sort(), ["name", "nickname"]);
  });

  it("never lets a caller write a column the table does not name", () => {
    // `workspaceId` and `id` come from the key and the path. A body that brought
    // its own used to be spread into Prisma's `data` by both PATCHes here.
    const ok = validateBody({ name: "x", systemPrompt: "p", workspaceId: "other", id: "mine" }, AGENT_CREATE);
    assert.equal(ok.ok, true);
    assert.equal("workspaceId" in (ok.data ?? {}), false);
    assert.equal("id" in (ok.data ?? {}), false);
  });
});

describe("the request body itself", () => {
  const request = (payload: string | undefined, method = "POST") =>
    new Request("http://localhost/api/agents", {
      method,
      headers: { "content-type": "application/json" },
      body: payload,
    });

  it("is a 400 when it is not JSON, where `request.json()` was a 500", async () => {
    // Measured on POST /api/agents: a malformed body threw a SyntaxError inside
    // the handler, which `withAuth` does not map.
    for (const payload of ["", "not json", "{", '{"name": "Ada",}']) {
      const parsed = await readJson(request(payload));
      assert.equal(parsed.ok, false, JSON.stringify(payload));
      assert.equal(parsed.error?.status, 400);
      assert.equal((await body(parsed.error!)).error, "request body is not valid JSON");
    }
  });

  it("hands the route what it parsed when it is", async () => {
    const parsed = await readJson(request('{"name":"Ada"}'));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.body, { name: "Ada" });
  });
});

describe("text", () => {
  it("trims, because a padded name is a row no one finds by name", () => {
    const result = validateBody({ name: "  Ada  " }, ONE);
    assert.equal(result.ok && result.data.name, "Ada");
  });

  it("refuses blank for a NOT NULL column and clears it for a nullable one", async () => {
    // `POST /api/knowledge {name:"   "}` was a 201: `if (name && !title)` is
    // truthy for a string of spaces, and `typeof name === "string"` passed.
    assert.equal((await body(validateBody({ name: "   " }, ONE).error!)).error, "name must be a non-empty string");
    const cleared = validateBody({ name: "x", nickname: "  " }, ONE);
    assert.equal(cleared.ok && cleared.data.nickname, null);
  });

  it("says how long it was", async () => {
    const result = validateBody({ name: "n".repeat(21) }, ONE);
    assert.match((await body(result.error!)).error, /name is 21 characters; at most 20/);
  });

  it("caps a systemPrompt at the column's own ceiling, not the default", async () => {
    const result = validateBody({ name: "Ada", systemPrompt: "p".repeat(20001) }, AGENT_CREATE);
    assert.match((await body(result.error!)).error, /systemPrompt is 20001 characters; at most 20000/);
  });
});

describe("booleans, which `Boolean()` was deciding", () => {
  it("will not read a string as a boolean", async () => {
    // `isActive: Boolean(isActive)` made "no", [] and 0 all mean true, in both
    // directions: a tool the caller meant to keep out of the agent's reach was
    // active on create, and measured `isActive: "no"` was a 201 with true stored.
    const result = validateBody({ isActive: "no" }, TOOL_PATCH);
    assert.match((await body(result.error!)).error, /isActive must be true or false, got a string/);
    assert.equal(validateBody({ isActive: [] }, TOOL_PATCH).ok, false);
    assert.equal(validateBody({ isActive: true }, TOOL_PATCH).ok, true);
  });
});

describe("the enum a SQLite column cannot enforce", () => {
  it("refuses a value outside the set and lists the set", async () => {
    // `status: "PAUSEDX"` was a clean insert — the column is a plain String and
    // the legal words live in a schema comment. Every `status !== "ACTIVE"` guard
    // then rejected the agent, and every `status` filter dropped it.
    const result = validateBody({ name: "Ada", systemPrompt: "p", status: "PAUSEDX" }, AGENT_CREATE);
    assert.match(
      (await body(result.error!)).error,
      /status must be one of ACTIVE \| PAUSED \| ARCHIVED, got "PAUSEDX"/,
    );
  });

  it("does not fold case, because the code compares with ===", () => {
    assert.equal(validateBody({ status: "active" }, AGENT_PATCH).ok, false);
    assert.equal(validateBody({ status: "ACTIVE" }, AGENT_PATCH).ok, true);
  });
});

describe("JSON columns", () => {
  it("refuses the scalar a Json column takes without complaint", () => {
    // `guardrails: 42` and `schema: 42` were 201s. Nothing here can read a number
    // as a guardrail, and `tools.ts` hands `schema` to the model as its
    // description of the arguments.
    assert.equal(validateBody({ guardrails: 42 }, AGENT_PATCH).ok, false);
    assert.equal(validateBody({ guardrails: "x" }, AGENT_PATCH).ok, false);
    assert.equal(validateBody({ guardrails: { maxSteps: 8 } }, AGENT_PATCH).ok, true);
    assert.equal(validateBody({ guardrails: [1, 2] }, AGENT_PATCH).ok, true);
  });

  it("refuses null and says what to send instead", async () => {
    // Prisma writes a NULL into a Json column with its own DbNull sentinel, so a
    // caller's null has no honest translation at this boundary.
    const result = validateBody({ guardrails: null }, AGENT_PATCH);
    assert.match((await body(result.error!)).error, /send \{\} to clear it/);
  });

  it("caps what one request can store", async () => {
    const result = validateBody(
      { guardrails: { blob: "x".repeat(2048) } },
      { guardrails: { kind: "json", max: 100 } } satisfies Schema,
    );
    assert.match((await body(result.error!)).error, /bytes of JSON; at most 100/);
  });
});

describe("an array of strings, which Agent.tools is", () => {
  it("refuses the scalar a later reader finds nothing in", async () => {
    // `tools: "kb_search"` was a 201 whose agent had no tools: the old code did
    // `.filter((t) => typeof t === "string")` over a string, which yields nothing.
    assert.equal(validateBody({ tools: "kb_search" }, AGENT_PATCH).ok, false);
    assert.match(
      (await body(validateBody({ tools: "kb_search" }, AGENT_PATCH).error!)).error,
      /tools must be an array of strings/,
    );
    assert.match(
      (await body(validateBody({ tools: [42] }, AGENT_PATCH).error!)).error,
      /tools\[0\] must be text, got a number/,
    );
  });

  it("treats absent as nothing sent, not as empty", () => {
    // The difference is what a PATCH must not do: clearing an agent's tools
    // because the caller only renamed it.
    assert.equal("tools" in (validateBody({ name: "x" }, AGENT_PATCH).data ?? {}), false);
    assert.deepEqual(validateBody({ tools: [] }, AGENT_PATCH).data?.tools, []);
  });

  it("deduplicates and trims, so [t, t] is one tool", () => {
    assert.deepEqual(validateBody({ tools: [" kb_search ", "calculator", "kb_search"] }, AGENT_PATCH).data?.tools, [
      "kb_search",
      "calculator",
    ]);
  });

  it("caps the list", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `t${i}`);
    assert.match(
      (await body(validateBody({ tools: many }, AGENT_PATCH).error!)).error,
      /tools holds 51 entries; at most 50/,
    );
  });
});

describe("null", () => {
  it("clears a nullable column and is refused on one that is not", () => {
    assert.equal(validateBody({ name: "x", nickname: null }, ONE).data?.nickname, null);
    const result = validateBody({ name: "x", nickname: null }, { name: { kind: "text" }, nickname: { kind: "text" } } satisfies Schema);
    assert.equal(result.ok, false);
  });

  it("is not the same as leaving a field out", () => {
    const absent = validateBody({ name: "x" }, ONE);
    assert.equal(absent.ok && "nickname" in absent.data, false);
    const sent = validateBody({ name: "x", nickname: null }, ONE);
    assert.equal(sent.ok && "nickname" in sent.data, true);
  });

  it("clears a nullable column the route stores as an empty string", () => {
    // `Agent.model` is `String @default("")` and "" is what means "heuristic
    // only", so `null` and "the column's own empty" are the same request here.
    const cleared = validateBody({ model: null }, AGENT_PATCH);
    assert.equal(cleared.ok && cleared.data.model, null);
  });
});

describe("PATCH", () => {
  it("refuses a body that asks to change nothing", async () => {
    // Measured: `PATCH /api/tools/:id {}` was a 200 with the row unchanged, and
    // `{nope: 1}` was the same 200, because every key went through a
    // `!== undefined` spread that found none.
    assert.match((await body(validateBody({ foo: 1 }, AGENT_PATCH, { requireWrite: true }).error!)).error, new RegExp(NO_FIELD_TO_UPDATE));
    assert.equal(validateBody({}, AGENT_PATCH, { requireWrite: true }).ok, false);
    assert.equal(validateBody({ model: null }, AGENT_PATCH, { requireWrite: true }).ok, true);
    assert.equal(validateBody({ name: "x" }, AGENT_PATCH, { requireWrite: true }).ok, true);
  });

  it("reports a missing required field ahead of the empty-update rule", async () => {
    const result = validateBody({ foo: 1 }, { status: { kind: "enum", required: true, values: ["ACTIVE"] } }, { requireWrite: true });
    assert.match((await body(result.error!)).error, /status is required/);
  });
});

describe("a route-control flag that is not a column", () => {
  it("refuses a truthy value the route was going to ignore", () => {
    // `sync: "yes"` was a 202 with a QUEUED row: the caller asked for the run
    // inline and got a run nobody had started, with nothing in the answer to say
    // so. `sync === true` is the only thing the route has ever honoured.
    assert.equal(boolFlag(undefined, "sync").value, undefined);
    assert.equal(boolFlag(null, "sync").value, undefined);
    assert.equal(boolFlag(true, "sync").value, true);
    assert.equal(boolFlag(false, "sync").value, false);
    assert.equal(boolFlag("yes", "sync").ok, false);
    assert.equal(boolFlag(1, "sync").ok, false);
  });

  it("says how to send it", async () => {
    const result = boolFlag("true", "sync");
    assert.match((await body(result.error!)).error, /sync must be true or false, got a string — send it unquoted/);
    assert.equal(result.error?.status, 400);
  });
});
