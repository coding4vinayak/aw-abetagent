import { prisma } from "./db";
import { searchKnowledge } from "./knowledge";
import { callTool } from "./tools";

const DEFAULT_MAX_STEPS = 8;

interface Guardrails {
  maxSteps?: number;
  escalateOn?: string[];
}

/** Exported for unit tests: pure guardrail parsing, no DB. */
export function readGuardrails(raw: unknown): Guardrails {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const g = raw as Record<string, unknown>;
  return {
    maxSteps: typeof g.maxSteps === "number" ? g.maxSteps : undefined,
    escalateOn: Array.isArray(g.escalateOn) ? g.escalateOn.filter((s): s is string => typeof s === "string") : undefined,
  };
}

async function addStep(runId: string, position: number, kind: string, content: string, label?: string) {
  return prisma.step.create({
    data: { runId, position, kind, content, ...(label != null ? { label } : {}) },
  });
}

/** Exported for unit tests: pure reply shaping, no DB. */
export function heuristicReply(input: string, hits: { documentTitle: string; text: string }[]): string {
  if (hits.length === 0) {
    return (
      `Thanks for reaching out. I checked our approved sources and could not find a confident answer, ` +
      `so I would rather hand you to a human than guess. A teammate will pick this up shortly.`
    );
  }
  const cites = hits.map((h, i) => `[${i + 1}] ${h.documentTitle}`).join(", ");
  const first = hits[0].text.split(/(?<=[.!?])\s/)[0] ?? hits[0].text;
  return `${first} (Sources: ${cites}). Happy to go deeper on any of this — just ask.`;
}

async function llmReply(
  model: string,
  systemPrompt: string,
  input: string,
  context: string,
): Promise<string | null> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 12000);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Approved context:\n${context}\n\nCustomer message:\n${input}\n\nAnswer only from the approved context. If it is not there, say you will escalate.` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * Execute one run to a terminal state. The heuristic path always works; the
 * LLM path is a best-effort upgrade with the heuristic as fallback, so a run
 * never fails just because a model is down. An uncertain agent escalates
 * rather than bluffing — that refusal is the feature.
 */
export async function runAgentRun(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: { agent: true },
  });
  if (!run || run.status === "COMPLETED" || run.status === "ESCALATED" || run.status === "FAILED") return;

  await prisma.run.update({ where: { id: runId }, data: { status: "RUNNING", startedAt: new Date() } });

  try {
    const agent = run.agent;
    const guardrails = readGuardrails(agent.guardrails);
    const maxSteps = guardrails.maxSteps ?? DEFAULT_MAX_STEPS;
    const escalateOn = (guardrails.escalateOn ?? ["human", "agent", "cancel my", "speak to someone"]).map((s) =>
      s.toLowerCase(),
    );
    const lowered = run.input.toLowerCase();
    let position = 0;

    const escalated = escalateOn.some((phrase) => phrase && lowered.includes(phrase));
    if (escalated) {
      await addStep(runId, position++, "THINK", "Customer asked for a human (or to cancel). Escalating without guessing.", "escalation-rule");
      await addStep(runId, position++, "ESCALATE", "Handed to a human with the full transcript attached.", "handoff");
      await prisma.run.update({
        where: { id: runId },
        data: { status: "ESCALATED", output: "Escalated to a human.", completedAt: new Date() },
      });
      return;
    }

    await addStep(runId, position++, "THINK", `Task: ${run.input.slice(0, 280)}`, "understand");

    const allowedTools = Array.isArray(agent.tools) ? agent.tools.filter((t): t is string => typeof t === "string") : [];
    const ctx = { workspaceId: run.workspaceId, knowledgeBaseId: null as string | null, runId };
    let context = "";
    if (allowedTools.includes("kb_search")) {
      await addStep(runId, position++, "TOOL_CALL", JSON.stringify({ tool: "kb_search", query: run.input.slice(0, 200) }), "kb_search");
      const result = await callTool("kb_search", { query: run.input, limit: 3 }, ctx, allowedTools);
      await addStep(runId, position++, "TOOL_RESULT", result.output.slice(0, 2000), "kb_search");
      context = result.output;
    }

    let reply: string | null = null;
    if (agent.model) {
      reply = await llmReply(agent.model, agent.systemPrompt, run.input, context || "(no approved sources matched)");
    }
    if (!reply) {
      const hits = await searchKnowledge(run.workspaceId, null, run.input, 3);
      reply = heuristicReply(run.input, hits);
    }

    if (position + 1 > maxSteps) {
      await addStep(runId, position++, "ESCALATE", "Step budget exhausted before a confident answer. Handing to a human.", "step-budget");
      await prisma.run.update({
        where: { id: runId },
        data: { status: "ESCALATED", output: "Step budget exhausted.", completedAt: new Date() },
      });
      return;
    }

    await addStep(runId, position++, "REPLY", reply, "final");
    await prisma.run.update({
      where: { id: runId },
      data: { status: "COMPLETED", output: reply, completedAt: new Date() },
    });
  } catch (error) {
    await prisma.run.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown error",
        completedAt: new Date(),
      },
    });
  }
}
