import { prisma } from "./db";
import { ingestDocument } from "./knowledge";
import { runAgentRun } from "./runner";

/**
 * A sample agent, so a new workspace can see the product work.
 *
 * The agent's promise is that its answers **cite their sources** and that
 * nothing it says is invented. None of that is visible in an empty workspace:
 * no agent, no knowledge base, no run, no citation — just a dashboard that
 * says *No agents yet. Create one via `POST /api/agents`*, which is developer
 * advice, not customer advice.
 *
 * Three rules keep it honest:
 *
 * 1. **The answer is the product's own.** The sample runs through
 *    `runAgentRun` — the same runner a real run uses — so the answer, the
 *    steps and the citation are the engine's, not a string written here. The
 *    agent carries **no model**, so it never calls out: with no model the
 *    runner answers from the approved sources or hands over to a human, and a
 *    first run therefore needs no API key to be honest.
 * 2. **It is unmistakably example data.** The agent and the handbook are named
 *    as examples, and the handbook's documents are about an imaginary company.
 * 3. **It is removable in one click**, and the removal takes the agent, its
 *    handbook, its documents, its chunks and its runs with it.
 */

/** The sample agent's name. A customer's own agent never looks like this. */
export const EXAMPLE_AGENT_NAME = "Example: Support agent";

/** The sample handbook's name. */
export const EXAMPLE_KB_NAME = "Example: Acme support handbook";

/** The question the sample asks, and the one the sample answers. */
export const EXAMPLE_QUESTION = "How long does a refund take?";

/** The handbook: two short documents, written so the retrieval has a top hit. */
export const EXAMPLE_DOCUMENTS = [
  {
    title: "Refund policy",
    text: `Refunds are issued to the original payment method within 5 business days of the return arriving at our warehouse.

A return is accepted within 30 days of delivery, and the buyer pays the return postage unless the item was faulty.

If a refund is late, check the original transaction first — a bank can take a few extra days to show it.`,
  },
  {
    title: "Shipping times",
    text: `Standard shipping takes 3 to 5 business days, and express shipping is next working day if you order before 2pm.

Orders placed after 2pm are picked up the next working day.

We ship to 34 countries; delivery outside those is quoted at checkout.`,
  },
];

const SYSTEM_PROMPT =
  "You are Acme's support agent. Answer only from the approved sources, and say which source " +
  "you used. If the sources do not answer the question, escalate to a human rather than guess.";

/**
 * Load the sample agent, and let it answer one question.
 *
 * Idempotent: a second call finds the example agent already there and changes
 * nothing, so a double-click cannot double the handbook.
 */
export async function loadExampleAgent(workspaceId: string) {
  const existing = await prisma.agent.findFirst({
    where: { workspaceId, name: EXAMPLE_AGENT_NAME },
    select: { id: true },
  });
  if (existing) return { created: false, agentId: existing.id, runId: null };

  const knowledgeBase = await prisma.knowledgeBase.create({
    data: {
      workspaceId,
      name: EXAMPLE_KB_NAME,
      description: "Example handbook for the sample support agent.",
    },
  });
  for (const document of EXAMPLE_DOCUMENTS) {
    await ingestDocument(knowledgeBase.id, document.title, document.text, "example");
  }

  const agent = await prisma.agent.create({
    data: {
      workspaceId,
      name: EXAMPLE_AGENT_NAME,
      description: "Example agent: answers from the handbook and cites what it used.",
      // No model: the runner answers from the approved sources (and escalates
      // when they do not hold the answer), so this needs no API key to be
      // honest about what it is.
      model: "",
      systemPrompt: SYSTEM_PROMPT,
      tools: ["kb_search", "escalate_to_human"],
    },
  });

  const run = await prisma.run.create({
    data: { workspaceId, agentId: agent.id, input: EXAMPLE_QUESTION, status: "QUEUED" },
  });
  // The same runner a real run uses, run inline so the answer is there when
  // the page comes back.
  await runAgentRun(run.id);

  return { created: true, agentId: agent.id, runId: run.id };
}

/**
 * Remove the sample agent, and everything that came with it.
 *
 * The agent's runs, and the handbook's documents and chunks, cascade from the
 * rows deleted here. A customer's own agent and handbook are not touched.
 */
export async function removeExampleAgent(workspaceId: string) {
  const agents = await prisma.agent.findMany({
    where: { workspaceId, name: EXAMPLE_AGENT_NAME },
    select: { id: true },
  });
  const handbooks = await prisma.knowledgeBase.findMany({
    where: { workspaceId, name: EXAMPLE_KB_NAME },
    select: { id: true },
  });
  const runs = await prisma.run.count({ where: { agentId: { in: agents.map((a) => a.id) } } });

  const agentIds = agents.map((a) => a.id);
  const handbookIds = handbooks.map((k) => k.id);
  if (agentIds.length) await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
  if (handbooks.length) {
    await prisma.knowledgeBase.deleteMany({ where: { id: { in: handbookIds } } });
  }

  return { agents: agents.length, knowledgeBases: handbooks.length, runs };
}

/** Whether a workspace is currently showing the sample agent. */
export async function hasExampleAgent(workspaceId: string): Promise<boolean> {
  const agent = await prisma.agent.findFirst({
    where: { workspaceId, name: EXAMPLE_AGENT_NAME },
    select: { id: true },
  });
  return Boolean(agent);
}
