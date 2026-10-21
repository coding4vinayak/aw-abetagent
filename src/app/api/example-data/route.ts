import { NextResponse } from "next/server";
import { authedWorkspaceId } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { loadExampleAgent, removeExampleAgent } from "@/lib/example-agent";

export const dynamic = "force-dynamic";

/**
 * The sample agent: `POST` loads it, `DELETE` removes it.
 *
 * The door is a **session or a key**, not a key only. The dashboard is the
 * browser and the API is the machine; a prospect who signs up on the web and a
 * developer who integrates the API are the same buyer, and neither should have
 * to wait for the other to see the product work.
 */
export async function POST(request: Request) {
  // The check is here, in the handler, and not in a helper: the guard that
  // reads every route in this app looks for it in the body, and a check behind
  // a call is a check nobody can see.
  const session = await getSession();
  const workspaceId = session
    ? session.workspaceId
    : await authedWorkspaceId(request).catch(() => null);
  if (!workspaceId) {
    return NextResponse.json({ error: "Sign in, or send an API key." }, { status: 401 });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await loadExampleAgent(workspaceId);
  return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  const workspaceId = session
    ? session.workspaceId
    : await authedWorkspaceId(request).catch(() => null);
  if (!workspaceId) {
    return NextResponse.json({ error: "Sign in, or send an API key." }, { status: 401 });
  }

  const removed = await removeExampleAgent(workspaceId);
  return NextResponse.json({ ok: true, removed });
}
