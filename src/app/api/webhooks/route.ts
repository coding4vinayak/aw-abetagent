import { NextResponse } from "next/server";
import { withAuth, authedWorkspaceId } from "@/lib/apikeys";
import { prisma } from "@/lib/db";
import { classifyTarget } from "@/lib/egress";
import { readJson, validateBody, eventNames, fieldProblem } from "@/lib/validate";
import { WEBHOOK_CREATE } from "@/lib/fields";
import { unknownEventsProblem, webhookPreview } from "@/lib/webhooks";
import crypto from "crypto";

export const dynamic = "force-dynamic";

async function GET_impl(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = await authedWorkspaceId(request, searchParams.get("workspaceId"));

  const webhooks = await prisma.webhook.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  // The signing secret is returned by POST, once; readers get the prefix.
  return NextResponse.json({ webhooks: webhooks.map(webhookPreview) });
}

async function POST_impl(request: Request) {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.error;
  const body = parsed.body as Record<string, unknown>;
  const workspaceId = await authedWorkspaceId(request, body.workspaceId);

  const input = validateBody(body, WEBHOOK_CREATE);
  if (!input.ok) return input.error;

  // The README shows an array of event names; the column is a String and the
  // reader splits it on commas. Both shapes are accepted, one is stored.
  const events = eventNames(body.events);
  if (!events.ok) return events.error;

  // A name this product never emits is a subscription that never fires — the
  // same silence as no subscription at all, arrived at from the other side.
  // The typo is refused here instead of stored.
  const unknown = unknownEventsProblem(events.values);
  if (unknown) return NextResponse.json({ error: unknown }, { status: 400 });

  // The destination is refused here (rule: no internal address) and again at
  // delivery time (the address DNS now points at) — the same two checks every
  // webhook write in this family answers with.
  const target = await classifyTarget(input.data.url, "url");
  if (!target.ok) return fieldProblem("url", target.reason);

  const secret = crypto.randomBytes(32).toString("hex");
  const webhook = await prisma.webhook.create({
    data: { workspaceId, url: input.data.url, events: events.values.join(","), secret },
  });
  return NextResponse.json(webhook, { status: 201 });
}

export const GET = withAuth(GET_impl);
export const POST = withAuth(POST_impl);
