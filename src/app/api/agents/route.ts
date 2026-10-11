import { NextResponse } from "next/server";
import { withAuth, authedWorkspaceId } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { BUILTIN_TOOLS } from "@/lib/tools";
import { pageParams } from "@/lib/pagination";
import { readJson, validateBody } from "@/lib/validate";
import { AGENT_CREATE } from "@/lib/fields";

export const dynamic = "force-dynamic";

async function GET_impl(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = await authedWorkspaceId(request, searchParams.get("workspaceId"));
  const status = searchParams.get("status");
  const { page, limit } = pageParams(searchParams, 20);


  const where: { workspaceId: string; status?: string } = { workspaceId };
  if (status) where.status = status;

  const [agents, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.agent.count({ where }),
  ]);

  return NextResponse.json({ agents, total, page, limit, totalPages: Math.ceil(total / limit) });
}

async function POST_impl(request: Request) {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body as Record<string, unknown>;
  const workspaceId = await authedWorkspaceId(request, body.workspaceId);

  const input = validateBody(body, AGENT_CREATE);
  if (!input.ok) return input.error;

  // A tool name that is neither a builtin nor one of this workspace's active
  // WEBHOOK rows is refused by name, because `runner.ts` offers the model only
  // what this list says it may call.
  const unknown = (input.data.tools ?? []).filter((t) => !(BUILTIN_TOOLS as readonly string[]).includes(t));
  if (unknown.length > 0) {
    const rows = await prisma.tool.findMany({
      where: { workspaceId, name: { in: unknown }, isActive: true },
      select: { name: true },
    });
    const known = new Set(rows.map((r) => r.name));
    const missing = unknown.filter((t) => !known.has(t));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Unknown tools: ${missing.join(", ")}` }, { status: 422 });
    }
  }

  // `""` is what the column holds for "no LLM, heuristic answers only", so a
  // caller who sent null to clear it lands on the same value as one who never
  // mentioned the field. `tools` is a NOT NULL column with no default, so an
  // omitted key becomes the empty list the old code also wrote — an agent that
  // calls nothing until someone adds some.
  const { model, tools, ...rest } = input.data;
  const agent = await prisma.agent.create({
    data: { workspaceId, ...rest, model: model ?? "", tools: tools ?? [] },
  });

  return NextResponse.json(agent, { status: 201 });
}

export const GET = withAuth(GET_impl);
export const POST = withAuth(POST_impl);
