import { NextResponse } from "next/server";

/**
 * A wrong-typed scalar used to be the database's problem, and the database answers
 * in one of two unhelpful ways. The table below is what abetagent's write routes
 * did before this existed. Each row says how it was established: a bare row was
 * recorded by `n5-aa-before.mts`, 25 cases sent over HTTP to this app's own dev
 * server on :3400 with a minted key and an otherwise-valid body (output:
 * `n5-aa-before.txt`). Four rows are marked [code], because that run's output
 * ends before them and they were read off the handler this engine replaced
 * instead — `sync === true`, `await request.json()` and destructuring an array
 * are each one line of that source, and are the kind of thing a source reading
 * settles as surely as a call.
 *
 *   POST /api/agents         name: 42                 500 PrismaClientValidationError
 *   POST /api/agents         model: 42                201, model "" — the value dropped
 *   POST /api/agents         tools: "kb_search"       201, tools [] — filtered away
 *   POST /api/agents         tools: [42]              201, tools []
 *   POST /api/agents         guardrails: 42           201, a number in a Json column
 *   POST /api/agents         status: "PAUSEDX"        201, and every later
 *                                                    POST …/runs 409s "Agent is PAUSEDX"
 *   PATCH /api/agents/:id    name: 42                 500
 *   PATCH /api/agents/:id    {}                       200, the row unchanged
 *   PATCH /api/agents/:id    no Authorization at all  200, renamed another workspace's agent
 *   POST /api/tools          name: 42                 500
 *   POST /api/tools          isActive: "no"           201, isActive true, via `Boolean()`
 *   POST /api/tools          isActive: []             201, isActive true
 *   POST /api/tools          schema: 42               201, a number in a Json column
 *   PATCH /api/tools/:id     isActive: "no"           200, true
 *   PATCH /api/tools/:id     {}                       200, the row unchanged
 *   POST /api/knowledge      name: "   "              201, a knowledge base named with spaces
 *   POST /api/agents/:id/runs   subject: 42           202, subject null — dropped
 *   POST /api/agents/:id/runs   sync: "yes"           202, queued instead of run inline  [code]
 *   POST /api/agents         body "prose"             500 — request.json() throws  [code]
 *   POST /api/agents         body (nothing)           500, same throw  [code]
 *   POST /api/agents         body []                  400 "name, systemPrompt required"  [code]
 *
 * The last three are a different fault in the same request, and each is one line
 * of the replaced source rather than a measured row. Destructuring an array yields
 * no keys, so `[]` was told it was missing fields it had no way to send, and a body
 * that is not JSON at all threw on its way out of `request.json()` — which is Next's
 * 500 for a client that simply wrote the wrong thing. What those three became is
 * measured, though: `n5-aa-after.mts` replays the whole table through the running
 * app, 47 cases including the three JSON-shape faults.
 *
 * A 500 is the one status a correct client retries, against a request that will
 * fail identically forever. The 201s are worse, and abetagent's are mostly of a
 * kind leadworks' table was not: not a wrong value stored, but a value quietly
 * not stored. `Boolean(isActive)` makes "no" and [] mean true. The `.filter
 * (typeof t === "string")` on `tools` makes a scalar or a number vanish, so an
 * agent gets no tools and the caller is told 201. `typeof model === "string" ?
 * model : ""` points the agent at no LLM because a number arrived where a model
 * name was expected. And `status` is a plain String column whose legal values
 * live in a schema comment, so "PAUSEDX" is a row that every `status !== "ACTIVE"`
 * guard rejects and every `status` filter drops — the agent exists and runs
 * nothing.
 *
 * So the check belongs at the boundary, against a declared table per route:
 *
 *  - No coercion. `Boolean(42)` and `String(42)` both turn a client bug into a
 *    stored value that is not what the caller meant.
 *  - Nothing dropped in silence. A field the route declares must arrive in the
 *    shape the route reads, or the request is refused naming it.
 *  - An absent key means "not mentioned" and is omitted, so a PATCH cannot reset
 *    a column the caller never named. `null` means "clear it" and only works
 *    where the column is nullable.
 *  - Every problem is reported at once, named by field.
 *  - Text is trimmed. `name: "   "` passes a type check and becomes a row no one
 *    can find by name.
 *  - A field the route did not declare never reaches Prisma.
 *
 * This is `src/lib/validate.ts` in leadworks and leadgenius, same engine, trimmed
 * to what abetagent's tables use. Dropped rather than carried "for parity":
 * `int`/`number` (no abetagent write route takes a number — `Chunk.position` and
 * `Step.position` are the worker's, and `guardrails.maxSteps` is inside a Json
 * column), `date` (no route takes a caller's timestamp), `validateItems` (no
 * column stores an array of caller objects), and `eventNames` (no comma-separated
 * String column here). `stringList` and `eventNames`'s exported wrapper went too,
 * because abetagent has no `ids.ts` to call them; the array rule itself is still
 * here as the `strings` kind, which is what `Agent.tools` needs.
 *
 * `Agent.guardrails` stays a plain `json` field, so its contents are not checked
 * here: `runner.ts`'s `readGuardrails` parses defensively and ignores what it does
 * not understand, which means `maxSteps: "8"` is still a silent default rather
 * than an error. Validating the inside of that column is a nested schema, and a
 * separate decision.
 */

import { collectBody, describe } from "./validation-engine";
import type { Schema, Validated, ValidationProblem } from "./validation-engine";

export type { FieldKind, Field, JsonObject, JsonArray, Schema, Validated, ValidationProblem } from "./validation-engine";
export { NO_FIELD_TO_UPDATE } from "./validation-engine";


export type Validation<S extends Schema> =
  | { ok: true; data: Validated<S>; error?: undefined }
  | { ok: false; data?: undefined; error: NextResponse };

/**
 * The engine's walk, projected into this app's envelope. Every rule — which kinds
 * exist, what a wrong value is called, what `null` and an absent key mean — is in
 * `./validation-engine`, one file for all six apps. This function is here because
 * what a problem *becomes* on the wire is this app's own decision, and the six
 * have never agreed about it: five answer 400 with `{ error, fields }`, abetapi
 * answers 422 with `{ error: { code, message }, fields }` because that envelope is
 * what its published OpenAPI document promises. Reunited rules, forked answer.
 */
export function validateBody<S extends Schema>(
  body: unknown,
  schema: S,
  opts: { requireWrite?: boolean } = {},
): Validation<S> {
  const result = collectBody(body, schema, opts);
  return result.ok ? result : fail(result.problems);
}

/**
 * Parse the body of a request that is required to carry one. `request.json()`
 * throws, and a throw inside a handler is Next's 500 — so a client that sends
 * `prose`, or nothing at all, was told the server broke. A value that parses is
 * still checked by `validateBody`, which is what refuses an array or a bare
 * string. Routes whose action needs no body never call this.
 */
export async function readJson(
  request: Request,
): Promise<{ ok: true; body: unknown; error?: undefined } | { ok: false; body?: undefined; error: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: bad("request body is not valid JSON") };
  }
  return { ok: true, body };
}

/**
 * A route-control flag that is not a column — `sync`, which decides whether the
 * run executes inline or goes on the queue. `sync === true` is the only thing the
 * route has ever honoured, and every truthy value that is not `true` was accepted
 * by the client and quietly ignored by the server: measured, `sync: "yes"`
 * answered 202 with a QUEUED row. Refusing it costs the caller one round trip;
 * ignoring it costs them the result they came to read.
 */
export function boolFlag(
  value: unknown,
  name: string,
): { ok: true; value: boolean | undefined; error?: undefined } | { ok: false; value?: undefined; error: NextResponse } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "boolean") {
    return {
      ok: false,
      error: bad(`${name} must be true or false, got ${describe(value)}${typeof value === "string" ? " — send it unquoted" : ""}`),
    };
  }
  return { ok: true, value };
}

/* ---------- the per-field walk ---------- */

function bad(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * One message per field, plus a `fields` object keyed the same way as the body the
 * caller sent. The key is the point: the 500s above named an argument only inside
 * a Prisma stack line that never reached the client.
 */
function fail(problems: ValidationProblem[]): { ok: false; error: NextResponse } {
  const fields: Record<string, string> = {};
  for (const [name, message] of problems) fields[name] = message;
  return {
    ok: false,
    error: NextResponse.json({ error: problems.map(([, message]) => message).join("; "), fields }, { status: 400 }),
  };
}

/**
 * A refusal about one field that the schema walk cannot express, because it is
 * about where the value *points* rather than whether it is well-formed — the
 * address-shape rule in `egress.ts`. Same envelope and status as `fail`, so a
 * client cannot tell the two apart by shape, only by the message.
 */
export function fieldProblem(name: string, message: string): NextResponse {
  return fail([[name, message]]).error;
}
