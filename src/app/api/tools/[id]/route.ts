import { NextResponse } from "next/server";
import { withAuth, assertOwns } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { classifyTarget } from "@/lib/egress";
import { toolCallbackUrl } from "@/lib/tools";
import { readJson, validateBody, fieldProblem } from "@/lib/validate";
import { TOOL_PATCH } from "@/lib/fields";

export const dynamic = "force-dynamic";

async function GET_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tool = await prisma.tool.findUnique({ where: { id } });
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, tool.workspaceId);
  return NextResponse.json(tool);
}

async function PATCH_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;

  const _owned = await prisma.tool.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!_owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, _owned.workspaceId);

  // `kind` is not here either: a WEBHOOK row repointed at BUILTIN would leave the
  // in-process handler's name on a row that POSTs to a URL, which is the one
  // state this file's caller can neither read nor repair.
  const input = validateBody(parsed.body, TOOL_PATCH, { requireWrite: true });
  if (!input.ok) return input.error;

  const callback = toolCallbackUrl(input.data.config);
  if (callback !== null) {
    const target = await classifyTarget(callback, "config.url");
    if (!target.ok) return fieldProblem("config.url", target.reason);
  }

  const tool = await prisma.tool.update({ where: { id }, data: input.data });
  return NextResponse.json(tool);
}

async function DELETE_impl(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const _owned = await prisma.tool.findUnique({ where: { id }, select: { workspaceId: true } });
  if (!_owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertOwns(request, _owned.workspaceId);
  await prisma.tool.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const GET = withAuth(GET_impl);
export const PATCH = withAuth(PATCH_impl);
export const DELETE = withAuth(DELETE_impl);
