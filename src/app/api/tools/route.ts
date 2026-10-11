import { NextResponse } from "next/server";
import { withAuth, authedWorkspaceId } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { classifyTarget } from "@/lib/egress";
import { BUILTIN_TOOLS, toolCallbackUrl } from "@/lib/tools";
import { readJson, validateBody, fieldProblem } from "@/lib/validate";
import { TOOL_CREATE } from "@/lib/fields";

export const dynamic = "force-dynamic";

async function GET_impl(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = await authedWorkspaceId(request, searchParams.get("workspaceId"));

  const tools = await prisma.tool.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  return NextResponse.json({
    tools,
    builtin: BUILTIN_TOOLS.map((name) => ({ name, kind: "BUILTIN" as const })),
  });
}

async function POST_impl(request: Request) {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body as Record<string, unknown>;
  const workspaceId = await authedWorkspaceId(request, body.workspaceId);

  const input = validateBody(body, TOOL_CREATE);
  if (!input.ok) return input.error;

  // `kind` is not in the table because this route only ever writes one value
  // into it: a BUILTIN row would shadow the in-process handler `tools.ts` already
  // has under that name, and the refusal is about which rows may exist rather
  // than what type a column holds — which is why it keeps its 422 and its own
  // sentence rather than becoming a field error.
  if (body.kind !== undefined && body.kind !== "WEBHOOK") {
    return NextResponse.json({ error: "kind must be WEBHOOK (builtins need no row)" }, { status: 422 });
  }
  if ((BUILTIN_TOOLS as readonly string[]).includes(input.data.name)) {
    return NextResponse.json({ error: `'${input.data.name}' is a builtin and needs no row` }, { status: 422 });
  }

  // A tool with no callback URL stays storable — `callTool` refuses it when the
  // agent asks for it, as it always has. This refuses only an address that is
  // present and internal, which is the one `callTool` would have to refuse later.
  const callback = toolCallbackUrl(input.data.config);
  if (callback !== null) {
    const target = await classifyTarget(callback, "config.url");
    if (!target.ok) return fieldProblem("config.url", target.reason);
  }

  const tool = await prisma.tool.create({
    data: { workspaceId, ...input.data, kind: "WEBHOOK" },
  });
  return NextResponse.json(tool, { status: 201 });
}

export const GET = withAuth(GET_impl);
export const POST = withAuth(POST_impl);
