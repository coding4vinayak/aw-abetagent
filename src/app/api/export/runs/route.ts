import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canManageRoles } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { exportDownloadHeaders, exportFilename, runCsvHeader, runCsvRow } from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * Runs per batch. Each row carries its own step trace, so the batch bounds the
 * number of run objects held at once without splitting a trace across pages.
 */
const RUN_BATCH = 200;

/**
 * GET /api/export/runs — the audit trail, streamed as CSV.
 *
 * The product's claim is that a rep or auditor can replay exactly what the agent
 * saw and did. This is the door for that: one row per run, with the ordered
 * steps in `steps_json`. Runs have no useful upper bound, so loading them into
 * the workspace JSON would turn a data-rights feature into an out-of-memory
 * error. The stream pages by primary key (`id > cursor`) and writes each batch
 * as it arrives.
 *
 * Authentication is checked before the stream is constructed. The stream only
 * reads the workspaceId captured from that session.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!canManageRoles(session.role)) {
    return NextResponse.json(
      { error: "Only an owner or admin can export the workspace." },
      { status: 403 },
    );
  }

  const workspaceId = session.workspaceId;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor: string | undefined;
      try {
        controller.enqueue(encoder.encode(runCsvHeader()));
        for (;;) {
          const runs = await prisma.run.findMany({
            where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) },
            orderBy: { id: "asc" },
            take: RUN_BATCH,
            select: {
              id: true,
              agentId: true,
              status: true,
              subject: true,
              input: true,
              output: true,
              error: true,
              createdAt: true,
              startedAt: true,
              completedAt: true,
              agent: { select: { name: true } },
              steps: {
                orderBy: { position: "asc" },
                select: {
                  position: true,
                  kind: true,
                  label: true,
                  content: true,
                  createdAt: true,
                },
              },
            },
          });
          if (runs.length === 0) break;

          let chunk = "";
          for (const run of runs) {
            chunk += runCsvRow({
              ...run,
              agentName: run.agent.name,
            });
          }
          controller.enqueue(encoder.encode(chunk));

          cursor = runs[runs.length - 1].id;
          if (runs.length < RUN_BATCH) break;
        }
        controller.close();
      } catch (err) {
        console.error("[export] run audit stream failed:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: exportDownloadHeaders(
      exportFilename(session.workspaceSlug, "runs"),
      "text/csv; charset=utf-8",
    ),
  });
}
