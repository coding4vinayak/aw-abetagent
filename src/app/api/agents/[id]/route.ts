import { NextResponse } from "next/server";
import { withAuth, assertOwns } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { BUILTIN_TOOLS } from "@/lib/tools";
import { readJson, validateBody } from "@/lib/validate";
import { AGENT_PATCH } from "@/lib/fields";

export const dynamic = "force-dynamic";

async function GET_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, agent.workspaceId);
  return NextResponse.json(agent);
}

async function PATCH_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;

  // Ownership first, before the body is read for anything and before Prisma is
  // touched. Measured on this app's own dev.db: the `assertOwns` below used to sit
  // inside `if (tools !== undefined) { if (unknown.length > 0) {`, so a PATCH that
  // did not mention tools — every rename, every pause — reached
  // `agent.update({ where: { id } })` with no key check of any kind. The same
  // request sent with no Authorization header at all renamed another workspace's
  // agent and answered 200 with the new row.
  const owned = await prisma.agent.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, owned.workspaceId);

  const input = validateBody(parsed.body, AGENT_PATCH, { requireWrite: true });
  if (!input.ok) return input.error;

  // A tool name that is neither a builtin nor one of this workspace's active
  // WEBHOOK rows. The workspace is the row's own, established above, so this
  // cannot be pointed at another tenant's tool names.
  const unknown = (input.data.tools ?? []).filter((t) => !(BUILTIN_TOOLS as readonly string[]).includes(t));
  if (unknown.length > 0) {
    const rows = await prisma.tool.findMany({
      where: { workspaceId: owned.workspaceId, name: { in: unknown }, isActive: true },
      select: { name: true },
    });
    const known = new Set(rows.map((r) => r.name));
    const missing = unknown.filter((t) => !known.has(t));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Unknown tools: ${missing.join(", ")}` }, { status: 422 });
    }
  }

  // `null` clears the model, and the column has no NULL: "" is the value
  // `runner.ts` reads as "heuristic answers only". Everything else is only
  // written when the caller named it, which is what `requireWrite` above holds to
  // — measured, `PATCH {}` was a 200 with the row unchanged.
  const { model, ...rest } = input.data;
  const agent = await prisma.agent.update({
    where: { id },
    data: { ...rest, ...(model !== undefined ? { model: model ?? "" } : {}) },
  });
  return NextResponse.json(agent);
}

async function DELETE_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const _owned = await prisma.agent.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!_owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, _owned.workspaceId);
  await prisma.agent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const GET = withAuth(GET_impl);
export const PATCH = withAuth(PATCH_impl);
export const DELETE = withAuth(DELETE_impl);
