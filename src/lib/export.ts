import { prisma } from "./db";
import { asRecord } from "./json";

/**
 * The export surface, which is what "Export anytime" and "your workspace data"
 * have to mean for an agent product.
 *
 * Two doors:
 *
 *   - `buildWorkspaceExport` is the portable copy: team, invitations, agents,
 *     tools, knowledge bases with their documents and chunks, and webhook
 *     destinations, as one human-readable JSON document.
 *   - `runCsvHeader` / `runCsvRow` are the audit trail: one row per run with the
 *     complete step trace in `steps_json`. Runs are the one table with no useful
 *     upper bound, so the route streams them in batches rather than loading a
 *     million-step workspace into one string.
 *
 * Content, not credentials. The rows a buyer owns are agents, runs, steps,
 * knowledge chunks, tool definitions and webhook destinations. Password digests,
 * session tokens, API-key hashes, invitation token hashes, tool/webhook signing
 * secrets and Stripe ids are not exported; a tool's `{ url, secret }` config
 * keeps the URL and drops the secret, and a webhook row keeps its destination
 * and events but never its signing key.
 *
 * Every query is scoped by workspaceId. A bug in the caller cannot turn one
 * buyer's export into another's.
 */
export const EXPORT_FORMAT = "abetagent.workspace";
export const EXPORT_VERSION = 1;

/** Collapse a slug to a filename-safe token, then fail closed to "workspace". */
function safeSlug(slug: string): string {
  return (
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
}

/** The download filename, pure so the header path is testable without a database. */
export function exportFilename(
  slug: string,
  part: "workspace" | "runs",
  at: Date = new Date(),
): string {
  const extension = part === "workspace" ? "json" : "csv";
  return `abetagent-${safeSlug(slug)}-${part}-${at.toISOString().slice(0, 10)}.${extension}`;
}

/** Every export shares these headers; `no-store` keeps a proxy from retaining a copy. */
export function exportDownloadHeaders(filename: string, contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

/** Drop a tool config's signing secret while keeping the rest of the config. */
export function toolConfigForExport(config: unknown): Record<string, unknown> {
  const copy = { ...asRecord(config) };
  delete copy.secret;
  return copy;
}

export async function buildWorkspaceExport(workspaceId: string, exportedAt: Date = new Date()) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true },
  });
  if (!workspace) throw new Error("Workspace not found");

  const [members, invitations, agents, tools, knowledgeBases, webhooks, runCount] =
    await Promise.all([
      prisma.membership.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { email: true, name: true, emailVerified: true } },
        },
      }),
      prisma.invite.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        // tokenHash is a live credential's digest, not content.
        select: {
          id: true,
          email: true,
          role: true,
          createdById: true,
          createdAt: true,
          expiresAt: true,
          acceptedAt: true,
        },
      }),
      prisma.agent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          model: true,
          systemPrompt: true,
          tools: true,
          guardrails: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.tool.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          kind: true,
          schema: true,
          config: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.knowledgeBase.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          documents: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              title: true,
              source: true,
              createdAt: true,
              chunks: {
                orderBy: { position: "asc" },
                select: {
                  id: true,
                  position: true,
                  text: true,
                  tokens: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      }),
      prisma.webhook.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "asc" },
        // secret is deliberately absent; the destination and event list are
        // configuration the buyer can recognize in a new home.
        select: {
          id: true,
          url: true,
          events: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.run.count({ where: { workspaceId } }),
    ]);

  const documents = knowledgeBases.reduce((sum, kb) => sum + kb.documents.length, 0);
  const chunks = knowledgeBases.reduce(
    (sum, kb) => sum + kb.documents.reduce((inner, doc) => inner + doc.chunks.length, 0),
    0,
  );

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    workspace,
    counts: {
      members: members.length,
      invitations: invitations.length,
      agents: agents.length,
      tools: tools.length,
      knowledgeBases: knowledgeBases.length,
      documents,
      chunks,
      webhooks: webhooks.length,
      runs: runCount,
    },
    notes: [
      "Credentials are excluded: password digests, session tokens, API keys and their hashes, invitation token hashes, tool and webhook signing secrets, and Stripe billing ids.",
      "Raw run traces are not embedded in this document. Download them from GET /api/export/runs, which streams one row per run with steps_json.",
    ],
    runs: {
      count: runCount,
      download: "/api/export/runs",
      contentType: "text/csv; charset=utf-8",
    },
    members,
    invitations,
    agents,
    // Keep the URL/handler; strip the signing key. A tool with no config stays
    // an empty object rather than becoming null, so its shape is stable.
    tools: tools.map((tool) => ({ ...tool, config: toolConfigForExport(tool.config) })),
    knowledgeBases,
    webhooks,
  };
}

export type WorkspaceExport = Awaited<ReturnType<typeof buildWorkspaceExport>>;

/* -------------------------------------------------------------------- run audit */

export interface RunStepCsv {
  position: number;
  kind: string;
  label: string | null;
  content: string;
  createdAt: Date | string;
}

export interface RunCsvRow {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  subject: string | null;
  input: string;
  output: string | null;
  error: string | null;
  createdAt: Date | string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  steps: RunStepCsv[];
}

/**
 * A text cell that cannot become a spreadsheet formula. Run input/output and
 * agent names are user/model text; a leading `=`, `+`, `-`, `@`, tab or CR is
 * the CSV injection shape, so it gets an apostrophe. Numbers never pass here.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function textCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function iso(value: Date | string | null): string {
  if (value === null) return "";
  return value instanceof Date ? value.toISOString() : value;
}

function jsonText(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

const RUN_HEADER = [
  "run_id",
  "agent_id",
  "agent_name",
  "status",
  "subject",
  "input",
  "output",
  "error",
  "created_at",
  "started_at",
  "completed_at",
  "steps_json",
];

export function runCsvHeader(): string {
  return `${RUN_HEADER.map(textCell).join(",")}\r\n`;
}

/**
 * One run per line. `steps_json` preserves the ordered trace (position, kind,
 * label, content, createdAt) rather than flattening it into repeated run rows,
 * so a reader can both scan the run list and replay what the agent saw.
 */
export function runCsvRow(row: RunCsvRow): string {
  return (
    [
      textCell(row.id),
      textCell(row.agentId),
      textCell(row.agentName),
      textCell(row.status),
      textCell(row.subject),
      textCell(row.input),
      textCell(row.output),
      textCell(row.error),
      textCell(iso(row.createdAt)),
      textCell(iso(row.startedAt)),
      textCell(iso(row.completedAt)),
      textCell(jsonText(row.steps)),
    ].join(",") + "\r\n"
  );
}
