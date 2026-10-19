import { prisma } from "./db";
import { searchKnowledge } from "./knowledge";
import { callTool } from "./tools";
import { triggerWebhooks, type WebhookEvent } from "./webhooks";

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

/** Terminal status → the event that announces it. Keys are the status column's values. */
const TERMINAL_EVENT = {
  COMPLETED: "run.completed",
  ESCALATED: "run.escalated",
  FAILED: "run.failed",
} as const satisfies Record<string, WebhookEvent>;

/**
 * Announce a run's terminal moment to every subscription that names it.
 *
 * Called after the row that makes the state true is committed, fire-and-forget
 * on purpose: `triggerWebhooks` never throws, and a dead receiver must not
 * fail a finished run — or hold the worker (or a sync caller) open while its
 * endpoint is tried. The payload is the announcement's job; the detail behind
 * it stays `GET /api/runs/{id}`.
 */
function announce(
  run: { id: string; workspaceId: string; agentId: string; subject: string | null },
  status: keyof typeof TERMINAL_EVENT,
  detail: { output: string | null; error?: string | null },
  completedAt: Date,
  startedAt: Date,
): void {
  void triggerWebhooks(run.workspaceId, TERMINAL_EVENT[status], {
    runId: run.id,
    agentId: run.agentId,
    subject: run.subject,
    status,
    output: detail.output,
    error: detail.error ?? null,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
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

/**
 * Exported for unit tests: whether a drafted reply is the handoff marker the
 * prompt asks for. Strict on purpose — the model is told to answer with
 * exactly `ESCALATE` when the approved context does not hold the answer; prose
 * that merely talks about escalating is a draft and completes as one.
 */
export function isHandoffReply(text: string): boolean {
  return /^escalate[.!]?$/i.test(text.trim());
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
          { role: "user", content: `Approved context:\n${context}\n\nCustomer message:\n${input}\n\nAnswer only from the approved context. If the answer is not there, reply with exactly: ESCALATE` },
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

  const startedAt = new Date();
  await prisma.run.update({ where: { id: runId }, data: { status: "RUNNING", startedAt } });

  try {
    const agent = run.agent;
    const guardrails = readGuardrails(agent.guardrails);
    const maxSteps = guardrails.maxSteps ?? DEFAULT_MAX_STEPS;
    const escalateOn = (guardrails.escalateOn ?? ["human", "agent", "cancel my", "speak to someone"]).map((s) =>
      s.toLowerCase(),
    );
    const lowered = run.input.toLowerCase();
    let position = 0;

    // The step names the phrase that actually matched: the defaults include
    // "agent", which fires on praise ("your agent functioned perfectly") as
    // readily as on a request for a human — a trace claiming the customer
    // "asked for a human (or to cancel)" was asserting something they never said.
    const matchedPhrase = escalateOn.find((phrase) => phrase && lowered.includes(phrase));
    if (matchedPhrase) {
      await addStep(runId, position++, "THINK", `Guardrail phrase "${matchedPhrase}" matched — escalating without guessing.`, "escalation-rule");
      await addStep(runId, position++, "ESCALATE", "Handed to a human with the full transcript attached.", "handoff");
      const completedAt = new Date();
      await prisma.run.update({
        where: { id: runId },
        data: { status: "ESCALATED", output: "Escalated to a human.", completedAt },
      });
      announce(run, "ESCALATED", { output: "Escalated to a human." }, completedAt, startedAt);
      return;
    }

    await addStep(runId, position++, "THINK", `Task: ${run.input.slice(0, 280)}`, "understand");

    const allowedTools = Array.isArray(agent.tools) ? agent.tools.filter((t): t is string => typeof t === "string") : [];
    const canSearch = allowedTools.includes("kb_search");
    const ctx = { workspaceId: run.workspaceId, knowledgeBaseId: null as string | null, runId };
    let context = "";
    if (canSearch) {
      await addStep(runId, position++, "TOOL_CALL", JSON.stringify({ tool: "kb_search", query: run.input.slice(0, 200) }), "kb_search");
      const result = await callTool("kb_search", { query: run.input, limit: 3 }, ctx, allowedTools);
      await addStep(runId, position++, "TOOL_RESULT", result.output.slice(0, 2000), "kb_search");
      context = result.output;
    }

    // A reply may only cite what a step retrieved. Without kb_search there are
    // no approved sources to draw on at all — before this gate, an agent whose
    // tools excluded kb_search still answered from the workspace documents,
    // citing "(Sources: [1] …)" while its trace held no TOOL_CALL to explain
    // where the citation came from.
    //
    // No approved source matched the question. The product's promise is to
    // hand a human the transcript rather than guess, so this is a real
    // escalation — an ESCALATE step, ESCALATED status and `run.escalated` —
    // not a COMPLETED run whose text promises a handoff that never fires.
    // Checked before the model: drafting from zero approved context is the
    // same guess, whatever the wording.
    const hits = canSearch ? await searchKnowledge(run.workspaceId, null, run.input, 3) : [];
    if (hits.length === 0) {
      const refusal = heuristicReply(run.input, hits);
      await addStep(
        runId,
        position++,
        "ESCALATE",
        canSearch
          ? "No confident answer in the approved sources — handed to a human with the full transcript attached."
          : "kb_search is not enabled for this agent, so there are no approved sources to draw on — guessing is not on the table. Handed to a human.",
        canSearch ? "no-confidence" : "no-sources",
      );
      const completedAt = new Date();
      await prisma.run.update({
        where: { id: runId },
        data: { status: "ESCALATED", output: refusal, completedAt },
      });
      announce(run, "ESCALATED", { output: refusal }, completedAt, startedAt);
      return;
    }

    // The budget is checked before a draft is paid for, so the step it writes
    // says what it means: at this point no confident answer exists yet.
    if (position + 1 > maxSteps) {
      await addStep(runId, position++, "ESCALATE", "Step budget exhausted before a confident answer. Handing to a human.", "step-budget");
      const completedAt = new Date();
      await prisma.run.update({
        where: { id: runId },
        data: { status: "ESCALATED", output: "Step budget exhausted.", completedAt },
      });
      announce(run, "ESCALATED", { output: "Step budget exhausted." }, completedAt, startedAt);
      return;
    }

    let reply: string | null = null;
    if (agent.model) {
      reply = await llmReply(agent.model, agent.systemPrompt, run.input, context || "(no approved sources matched)");
    }
    if (reply && isHandoffReply(reply)) {
      // The drafting model declined: the prompt asks for exactly `ESCALATE`
      // when the approved context does not hold the answer, and that must be
      // the same handoff the heuristic's no-confidence stop fires — a reply
      // that promises a teammate and ends COMPLETED pages nobody.
      const refusal = heuristicReply(run.input, []);
      await addStep(runId, position++, "ESCALATE", "The drafted answer declined to guess — handed to a human with the full transcript attached.", "model-handoff");
      const completedAt = new Date();
      await prisma.run.update({
        where: { id: runId },
        data: { status: "ESCALATED", output: refusal, completedAt },
      });
      announce(run, "ESCALATED", { output: refusal }, completedAt, startedAt);
      return;
    }
    if (!reply) {
      reply = heuristicReply(run.input, hits);
    }

    await addStep(runId, position++, "REPLY", reply, "final");
    const completedAt = new Date();
    await prisma.run.update({
      where: { id: runId },
      data: { status: "COMPLETED", output: reply, completedAt },
    });
    announce(run, "COMPLETED", { output: reply }, completedAt, startedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const completedAt = new Date();
    await prisma.run.update({
      where: { id: runId },
      data: { status: "FAILED", error: message, completedAt },
    });
    announce(run, "FAILED", { output: null, error: message }, completedAt, startedAt);
  }
}
