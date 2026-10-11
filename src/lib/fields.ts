import type { Schema } from "./validate";
import { AGENT_STATUSES } from "./enums";

/**
 * What each write route accepts, one declared table per route. It lives here
 * rather than beside its handler because a collection route and its `[id]`
 * sibling write the same columns — an agent's `PATCH` and `POST` disagreeing
 * about what `status` may hold is exactly the kind of drift a table you can read
 * in one screen prevents. The API's whole input contract is this file.
 *
 * `workspaceId` and `id` are absent everywhere on purpose: they come from the key
 * and the path, never the body. `POST /api/agents` and `POST /api/tools` read
 * `body.workspaceId` only to hand it to `authedWorkspaceId`, which refuses
 * anything that is not the key's own workspace and then returns the id to use.
 *
 * A field not listed here never reaches Prisma. That retires two shapes this app
 * was written with: the `...(name !== undefined ? { name } : {})` spread on every
 * PATCH, and the per-field `typeof` guards that were the whole check before —
 * `typeof model === "string" ? model : ""`, which measured as a 201 that stored
 * the empty string, so a number where a model name belongs silently moved the
 * agent to heuristic-only and told nobody.
 *
 * No `json` field below is `nullable`. Prisma writes a NULL in a JSON column with
 * its own `DbNull` sentinel rather than `null`, so "clear this" has no shape a
 * client can send that is not a translation at the boundary; `{}` is the empty
 * value in the same form every reader of those columns expects.
 *
 * Deliberately missing, because no handler has ever written them: `Run.status`,
 * `Run.output`, `Run.error`, `Run.startedAt`/`completedAt` and every `Step` column
 * (all `runner.ts`'s), `Chunk.text`/`tokens`/`position` (`knowledge.ts`'s, from a
 * document's text), `Tool.kind` (this API creates WEBHOOK rows and nothing else),
 * and `sync` on a run — a route-control flag rather than a column, which the
 * handler checks with `boolFlag` because `sync === true` is the only thing it has
 * ever honoured.
 */

export const AGENT_CREATE = {
  name: { kind: "text", required: true, max: 200 },
  description: { kind: "text", nullable: true, max: 2000 },
  /**
   * The column is `String @default("")` and "" is the value that means
   * "heuristic only, never call an LLM" — `runner.ts` branches on `if (agent.model)`
   * and the dashboard renders "heuristic". So a caller clears it with `null`,
   * which the route maps to the empty string the NOT NULL column holds. Omitted
   * means the default, which is the same thing.
   */
  model: { kind: "text", nullable: true, max: 120 },
  systemPrompt: { kind: "text", required: true, max: 20000 },
  // Ordered tool names this agent may call. The set is not closed — three
  // builtins plus whatever WEBHOOK rows this workspace has — so the route checks
  // membership against `BUILTIN_TOOLS` and the workspace's own tools, and this
  // says only what the column's shape is. Measured: `tools: "kb_search"` and
  // `tools: [42]` were both a 201 whose agent had no tools at all.
  tools: { kind: "strings", max: 50 },
  guardrails: { kind: "json" },
  status: { kind: "enum", values: AGENT_STATUSES },
} satisfies Schema;

/**
 * Every field is optional here, which is what makes an omitted key mean "not
 * mentioned". The `systemPrompt` a create requires, a patch may leave alone.
 */
export const AGENT_PATCH = {
  name: { kind: "text", max: 200 },
  description: { kind: "text", nullable: true, max: 2000 },
  model: { kind: "text", nullable: true, max: 120 },
  systemPrompt: { kind: "text", max: 20000 },
  tools: { kind: "strings", max: 50 },
  guardrails: { kind: "json" },
  status: { kind: "enum", values: AGENT_STATUSES },
} satisfies Schema;

/**
 * `description` is required because the column is NOT NULL and a tool with no
 * description is a tool the model has to guess at — the route already said so, and
 * the table says it in the same words the rest of the API uses.
 */
export const TOOL_CREATE = {
  name: { kind: "text", required: true, max: 100 },
  description: { kind: "text", required: true, max: 2000 },
  // JSON Schema for the arguments object, and for a WEBHOOK the {url, secret}
  // config. `schema: 42` was a 201 with a number in a Json column, which
  // `tools.ts` then hands to the model as its description of the arguments.
  schema: { kind: "json" },
  config: { kind: "json" },
  // `Boolean(isActive)` made "no", [] and 0 all mean true, in both directions: a
  // tool the caller meant to keep out of the agent's reach was active on create.
  isActive: { kind: "bool" },
} satisfies Schema;

/** `name` is here, so renaming into another tool's name is still a 409 conflict. */
export const TOOL_PATCH = {
  name: { kind: "text", max: 100 },
  description: { kind: "text", max: 2000 },
  schema: { kind: "json" },
  config: { kind: "json" },
  isActive: { kind: "bool" },
} satisfies Schema;

export const KNOWLEDGE_BASE_CREATE = {
  name: { kind: "text", required: true, max: 200 },
  description: { kind: "text", nullable: true, max: 2000 },
} satisfies Schema;

/**
 * `knowledgeBaseId` is checked two ways: here for its type, and in the route
 * against a `workspaceId` filter, because ingesting into a base that exists but
 * is not yours is not a type error — measured, it used to be a plain
 * `findUnique({ id })`, which let any valid key push text into another tenant's
 * corpus, which that tenant's agent then retrieved as its own knowledge.
 */
export const DOCUMENT_INGEST = {
  knowledgeBaseId: { kind: "text", required: true, max: 32 },
  title: { kind: "text", required: true, max: 500 },
  // `knowledge.ts` windowed-chunks this into `Chunk` rows; the cap is on what one
  // request may put in, not on what the retriever can hold.
  text: { kind: "text", required: true, max: 200000 },
  source: { kind: "text", nullable: true, max: 2000 },
} satisfies Schema;

/**
 * `status` is not here: a new run is QUEUED and `runner.ts` moves it on from
 * there. `agentId` is the path, never the body.
 */
export const RUN_CREATE = {
  input: { kind: "text", required: true, max: 20000 },
  subject: { kind: "text", nullable: true, max: 200 },
} satisfies Schema;
