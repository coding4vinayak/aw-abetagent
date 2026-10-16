import { createHmac } from "node:crypto";
import { prisma } from "./db";
import { assertAllowedTarget } from "./egress";
import { searchKnowledge } from "./knowledge";

export interface ToolContext {
  workspaceId: string;
  knowledgeBaseId: string | null;
  runId: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_CHARS = 4000;

/** Builtins handled in-process. Everything else must have a Tool row. */
export const BUILTIN_TOOLS = ["kb_search", "http_fetch", "escalate_to_human"] as const;

/**
 * The callback address a WEBHOOK tool's config names, or null when it names none.
 *
 * Exported because three readers share this `{url, secret}` shape — this file
 * before it posts, and both routes that store it before they answer — and a cast
 * typed out per reader is a cast that can disagree with the others.
 */
export function toolCallbackUrl(config: unknown): string | null {
  const url = (config as { url?: unknown } | null)?.url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  allowedTools: string[],
): Promise<ToolResult> {
  if (!allowedTools.includes(name)) {
    return { ok: false, output: `Tool '${name}' is not enabled for this agent.` };
  }

  switch (name) {
    case "kb_search": {
      const query = String(args.query ?? "");
      const limit = Math.min(Math.max(Number(args.limit ?? 3) || 3, 1), 10);
      if (!query.trim()) return { ok: false, output: "kb_search needs a query." };
      const hits = await searchKnowledge(ctx.workspaceId, ctx.knowledgeBaseId, query, limit);
      if (hits.length === 0) return { ok: true, output: "No approved sources matched." };
      return {
        ok: true,
        output: hits.map((h, i) => `[${i + 1}] ${h.documentTitle}: ${h.text}`).join("\n\n"),
      };
    }
    case "http_fetch": {
      const url = String(args.url ?? "");
      if (!/^https?:\/\//i.test(url)) return { ok: false, output: "http_fetch needs an http(s) URL." };
      try {
        // The URL is model-supplied, so this is the one site in the family where the
        // address never passed through a validated write at all.
        await assertAllowedTarget(url, "url");
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "user-agent": "AbetAgent/1.0 (+research)" },
        });
        clearTimeout(timer);
        const text = (await res.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return { ok: true, output: `HTTP ${res.status}. ${text.slice(0, FETCH_MAX_CHARS)}` };
      } catch (error) {
        return { ok: false, output: `Fetch failed: ${error instanceof Error ? error.message : "unknown"}` };
      }
    }
    case "escalate_to_human": {
      return { ok: true, output: `Escalation requested: ${String(args.reason ?? "needs a human")}` };
    }
    default: {
      const tool = await prisma.tool.findUnique({
        where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } },
      });
      if (!tool || !tool.isActive || tool.kind !== "WEBHOOK") {
        return { ok: false, output: `Unknown or inactive tool '${name}'.` };
      }
      const url = toolCallbackUrl(tool.config);
      if (!url) return { ok: false, output: `Tool '${name}' has no URL configured.` };
      const secret = (tool.config as { secret?: string } | null)?.secret;
      try {
        await assertAllowedTarget(url, "url");
        const body = JSON.stringify({ args, runId: ctx.runId, tool: name });
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (secret) {
          headers["x-abetagent-signature"] = createHmac("sha256", secret)
            .update(`${timestamp}.${body}`)
            .digest("hex");
          headers["x-abetagent-timestamp"] = timestamp;
          // The same secret, the generic spelling: body-only HMAC hex with a
          // `sha256=` prefix — what an inbound nuCRM plugin webhook verifies
          // natively. Its freshness check only engages when a header named
          // `x-webhook-timestamp` is present, and that header is deliberately
          // absent: this is a request-response tool call, not a fire-and-forget
          // delivery, and the timestamped pair above already pins time for the
          // receivers that want it.
          headers["x-webhook-signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
        clearTimeout(timer);
        const text = await res.text();
        return { ok: res.ok, output: text.slice(0, FETCH_MAX_CHARS) };
      } catch (error) {
        return { ok: false, output: `Webhook tool failed: ${error instanceof Error ? error.message : "unknown"}` };
      }
    }
  }
}
