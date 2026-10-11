import { NextResponse } from "next/server";
import { withAuth, authedWorkspaceId } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { ingestDocument, searchKnowledge } from "@/lib/knowledge";
import { readJson, validateBody } from "@/lib/validate";
import { DOCUMENT_INGEST, KNOWLEDGE_BASE_CREATE } from "@/lib/fields";

export const dynamic = "force-dynamic";

async function GET_impl(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = await authedWorkspaceId(request, searchParams.get("workspaceId"));
  const q = searchParams.get("q");


  if (q) {
    const hits = await searchKnowledge(workspaceId, null, q, 5);
    return NextResponse.json({ hits });
  }

  const bases = await prisma.knowledgeBase.findMany({
    where: { workspaceId },
    include: { _count: { select: { documents: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ knowledgeBases: bases });
}

async function POST_impl(request: Request) {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body as Record<string, unknown>;
  const workspaceId = await authedWorkspaceId(request, body.workspaceId);

  // The body says which of the two things this route does: a `name` and no
  // `title` creates a knowledge base, a `knowledgeBaseId` with a `title` and a
  // `text` ingests a document into one. Read as the caller's own words rather
  // than as truthiness, so `name: 42` is a wrong type in the create branch
  // instead of a missing field in the ingest one.
  if (body.name !== undefined && body.title === undefined) {
    const input = validateBody(body, KNOWLEDGE_BASE_CREATE);
    if (!input.ok) return input.error;
    const kb = await prisma.knowledgeBase.create({ data: { workspaceId, ...input.data } });
    return NextResponse.json(kb, { status: 201 });
  }

  const input = validateBody(body, DOCUMENT_INGEST);
  if (!input.ok) return input.error;

  // Scoped to the caller's workspace: this used to be findUnique({id}), so any
  // valid key could push text into another tenant's corpus — which is not just
  // a data-integrity problem here, it is that tenant's agent retrieving the
  // injected text as its own knowledge. Same 404 either way, so an id from
  // another workspace cannot be distinguished from one that does not exist.
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: input.data.knowledgeBaseId, workspaceId },
  });
  if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });

  // `?? undefined`: `source` is a nullable column, so a caller can send null to
  // mean "no source", and `ingestDocument` leaves the column out of the row for
  // both null and absent. Its signature only names the second of those.
  const result = await ingestDocument(kb.id, input.data.title, input.data.text, input.data.source ?? undefined);
  return NextResponse.json(result, { status: 201 });
}

export const GET = withAuth(GET_impl);
export const POST = withAuth(POST_impl);
