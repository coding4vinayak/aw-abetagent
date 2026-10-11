import { prisma } from "../src/lib/db";
import { ingestDocument } from "../src/lib/knowledge";
import { runAgentRun } from "../src/lib/runner";
import { mintApiKey } from "../src/lib/apikeys";

/**
 * Create the demo row only if it is not there yet. KnowledgeBase, Agent and Run
 * have no unique constraint on name (deliberately: Tool is the one that carries
 * @@unique([workspaceId, name])), so this cannot be an upsert — the lookup is
 * the findFirst and the demo workspace is the scope. Without it, every
 * `npm run db:seed` added another copy of the demo data.
 */
async function once<T>(label: string, find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const existing = await find();
  if (existing) {
    console.log(`Already present: ${label}`);
    return existing;
  }
  const created = await create();
  console.log(`Created: ${label}`);
  return created;
}

async function main() {
  console.log("Seeding AbetAgent...");

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Workspace", slug: "demo" },
  });
  console.log("Workspace:", workspace.id);

  const kb = await once(
    "knowledge base Support handbook",
    () => prisma.knowledgeBase.findFirst({ where: { workspaceId: workspace.id, name: "Support handbook" } }),
    () => prisma.knowledgeBase.create({
      data: {
        workspaceId: workspace.id,
        name: "Support handbook",
        description: "Refund, shipping and plan-change answers the agent may cite.",
      },
    }),
  );

  const chapters = [
    ["Refunds", "Refunds are issued to the original payment method within 5 to 10 business days. " +
      "Orders under 30 days old qualify for a full refund with no questions asked. " +
      "Contact billing@acme.test with the order number to start one."],
    ["Shipping", "Standard shipping takes 3 to 5 business days and is free over $50. " +
      "Express shipping takes 1 to 2 business days. Tracking is emailed when the label is created."],
  ] as const;
  if ((await prisma.document.count({ where: { knowledgeBaseId: kb.id } })) === 0) {
    for (const [title, text] of chapters) {
      const ingested = await ingestDocument(kb.id, title, text, "handbook");
      console.log(`Document: ${title} (${ingested.chunks} chunks)`);
    }
  } else {
    console.log("Already present: handbook documents");
  }
  console.log("Knowledge base:", kb.id);

  const agent = await once(
    "agent Support Agent",
    () => prisma.agent.findFirst({ where: { workspaceId: workspace.id, name: "Support Agent" } }),
    () => prisma.agent.create({
      data: {
        workspaceId: workspace.id,
        name: "Support Agent",
        description: "Answers refund and shipping questions from the handbook, escalates the rest.",
        model: "",
        systemPrompt:
          "You are a support agent. Answer only from the approved sources provided. " +
          "If the answer is not there, escalate to a human instead of guessing.",
        tools: ["kb_search", "escalate_to_human"],
        guardrails: { maxSteps: 8, escalateOn: ["human", "cancel my", "speak to someone", "manager"] },
        status: "ACTIVE",
      },
    }),
  );
  console.log("Agent:", agent.id);

  // One demo run per agent, so the timeline has something to show without the
  // seed growing a new conversation every time it is re-run.
  const run = await once(
    "seed demo run",
    () => prisma.run.findFirst({ where: { agentId: agent.id, subject: "seed demo" } }),
    () => prisma.run.create({
      data: {
        workspaceId: workspace.id,
        agentId: agent.id,
        subject: "seed demo",
        input: "How long do refunds take?",
        status: "QUEUED",
      },
    }),
  );
  if (run.status === "QUEUED") await runAgentRun(run.id);
  const done = await prisma.run.findUnique({ where: { id: run.id } });
  console.log("Seed run:", done?.status, "-", done?.output?.slice(0, 80));

  
  // Demo API key for smoke tests and the live demo. The plaintext prints once
  // here and is never stored — copy it into smoke scripts, then rotate it.
  await prisma.apiKey.deleteMany({ where: { workspaceId: workspace.id, name: "Demo key" } });
  const demoKey = await mintApiKey(workspace.id, "Demo key");
  console.log("Demo key (copy now, never shown again):", demoKey.plaintext);
console.log("Seeding complete!");
  console.log(`Agent: ${agent.id} (workspace demo)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
