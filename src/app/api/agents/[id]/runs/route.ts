import { NextResponse } from "next/server";
import { withAuth, assertOwns } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { queues, enqueue, QueueUnavailableError } from "@/lib/queue";
import { runAgentRun } from "@/lib/runner";
import { intParam } from "@/lib/pagination";
import { readJson, validateBody, boolFlag } from "@/lib/validate";
import { RUN_CREATE } from "@/lib/fields";

export const dynamic = "force-dynamic";

/**
 * POST on this same file checked that the agent was the caller's; GET checked
 * nothing, so the run history — every prompt and every step an agent took for
 * that tenant — was readable by anyone who could name an agentId. withAuth does
 * not authenticate, it only maps errors, so "wrapped in withAuth" was never the
 * same as "requires a key".
 */
async function GET_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = intParam(searchParams, "limit", 20, 1, 100);

  const agent = await prisma.agent.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!agent) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await assertOwns(request, agent.workspaceId);

  const runs = await prisma.run.findMany({
    where: { agentId: id, ...(status ? { status } : {}) },
    include: { steps: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ runs });
}

async function POST_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, agent.workspaceId);
  if (agent.status !== "ACTIVE") {
    return NextResponse.json({ error: `Agent is ${agent.status}` }, { status: 409 });
  }

  const input = validateBody(parsed.body, RUN_CREATE);
  if (!input.ok) return input.error;
  // `sync` decides how the run is executed rather than what a column holds, so it
  // is checked outside the table. The route has only ever honoured `true`:
  // measured, `sync: "yes"` answered 202 with a QUEUED row, which is the opposite
  // of what the caller asked for and gave them no way to notice.
  const sync = boolFlag((parsed.body as Record<string, unknown>).sync, "sync");
  if (!sync.ok) return sync.error;

  const run = await prisma.run.create({
    data: {
      workspaceId: agent.workspaceId,
      agentId: id,
      // The trimmed text is what the runner reads and what every later Step
      // quotes, so the row holds the value the caller meant, not its padding.
      input: input.data.input,
      ...(input.data.subject !== undefined ? { subject: input.data.subject } : {}),
      status: "QUEUED",
    },
  });

  // sync=true executes inline (tests, demos). Otherwise the queue owns it.
  if (sync.value === true) {
    await runAgentRun(run.id);
    const done = await prisma.run.findUnique({
      where: { id: run.id },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    return NextResponse.json(done, { status: 201 });
  }

  try {
    await enqueue(queues.runs, "run-agent", { runId: run.id });
  } catch (error) {
    if (error instanceof QueueUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  return NextResponse.json(run, { status: 202 });
}

export const GET = withAuth(GET_impl);
export const POST = withAuth(POST_impl);
