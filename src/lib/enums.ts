/**
 * The string columns in `prisma/schema.prisma` that hold an enumerated value
 * document that value in a comment, because SQLite has no enum type and Prisma
 * has no way to check a `String` against a comment. So `status: "PAUSEDX"` is a
 * clean insert today, and the row is then invisible to every comparison the code
 * makes — `POST /api/agents/:id/runs` refuses anything that is not exactly
 * "ACTIVE", `GET /api/agents?status=` matches nothing else, and the `@@index
 * ([workspaceId, status])` that makes that query cheap indexes the typo like any
 * other value.
 *
 * These arrays are transcribed from those comments and nothing else; where a
 * table here and the schema comment disagree, the schema is the one to fix. The
 * write routes validate against them (see `src/lib/validate.ts`) so a value
 * outside the set answers 400 at the boundary instead of becoming a row that
 * silently does nothing.
 *
 * Only the sets a write route actually takes are listed. `Run.status`
 * (QUEUED | RUNNING | COMPLETED | ESCALATED | FAILED), `Step.kind` (THINK |
 * TOOL_CALL | TOOL_RESULT | REPLY | ESCALATE), `Membership.role` and `Invite.role`
 * also have comment sets and also mean something, but nothing in this API lets a
 * caller write them — `runner.ts` and the auth layer do — so declaring them here
 * would be a table with no route behind it. `Tool.kind` is deliberately not a set
 * either: this API only ever creates WEBHOOK rows, and `POST /api/tools` answers
 * 422 for any other kind because a BUILTIN row would shadow the in-process
 * handler. That is a rule about which rows may exist, not about a column's type,
 * so it stays in the route where its status code and its message belong.
 */

/** Agent.status */
export const AGENT_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
