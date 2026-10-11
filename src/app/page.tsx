import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter } from "@/components/site";

export const metadata: Metadata = {
  title: "AbetAgent — Agents that finish the job, not just chat about it.",
  description: "Define an agent, give it your approved sources, and it retrieves, reasons in a visible step trace, answers with citations — and escalates to a human instead of bluffing.",
};

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SiteNav />
      <main>
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
          <p className="inline-block rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            v1.0 · Now generally available
          </p>
          <h1 className="mt-6 text-5xl font-bold tracking-tight">AbetAgent</h1>
          <p className="mx-auto mt-4 max-w-2xl text-xl text-gray-600">Agents that finish the job, not just chat about it.</p>
          <p className="mx-auto mt-3 max-w-2xl text-gray-600">Define an agent, give it your approved sources, and it retrieves, reasons in a visible step trace, answers with citations — and escalates to a human instead of bluffing.</p>
          <div className="mt-8 flex justify-center gap-4">
            <a href="/dashboard?workspace=demo" className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 transition">
              Open live demo
            </a>
            <Link href="/pricing" className="rounded-lg border border-gray-300 hover:bg-gray-50 px-6 py-3 font-semibold transition">
              Pricing · $99 per month
            </Link>
          </div>
        </section>
        <section id="features" className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-center text-2xl font-bold">Why teams pick AbetAgent</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <h3 className="font-bold text-gray-900">Cited answers or nothing</h3>
            <p className="mt-2 text-sm text-gray-600">Every reply names its sources. No match in your documents means a handoff, not a hallucination.</p>
          </div>
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <h3 className="font-bold text-gray-900">A step trace you can audit</h3>
            <p className="mt-2 text-sm text-gray-600">THINK → TOOL_CALL → TOOL_RESULT → REPLY/ESCALATE. Replay exactly what the agent saw and did.</p>
          </div>
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <h3 className="font-bold text-gray-900">Guardrails that end runs</h3>
            <p className="mt-2 text-sm text-gray-600">Escalation phrases hand off instantly; a step budget stops runaway loops and names the node.</p>
          </div>
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <h3 className="font-bold text-gray-900">Heuristic-first, LLM-optional</h3>
            <p className="mt-2 text-sm text-gray-600">Keyword retrieval answers without any model. Add a key and an LLM drafts with the heuristic as fallback — a run never fails because a model is down.</p>
          </div>
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <h3 className="font-bold text-gray-900">Tools you allowlist</h3>
            <p className="mt-2 text-sm text-gray-600">kb_search, http_fetch, escalate_to_human built in; webhook tools POST HMAC-signed JSON.</p>
          </div>
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <h3 className="font-bold text-gray-900">Knowledge bases you own</h3>
            <p className="mt-2 text-sm text-gray-600">Ingest your handbook and docs. Search is deterministic keyword overlap — explainable, no vectors to babysit.</p>
          </div>
          </div>
        </section>
        <section className="border-y border-gray-200 bg-gray-50">
          <div className="mx-auto max-w-4xl space-y-6 px-6 py-12">
            <h2 className="text-2xl font-bold">Live in three steps</h2>
          <div className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">1</span>
            <div><p className="font-bold text-gray-900">Write the system prompt</p><p className="mt-1 text-sm text-gray-600">Start from the demo support agent, or define your own with tools and guardrails.</p></div>
          </div>
          <div className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">2</span>
            <div><p className="font-bold text-gray-900">Ingest your sources</p><p className="mt-1 text-sm text-gray-600">Upload the documents the agent is allowed to cite. Nothing else exists to it.</p></div>
          </div>
          <div className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">3</span>
            <div><p className="font-bold text-gray-900">Start runs, read traces</p><p className="mt-1 text-sm text-gray-600">Ask anything. Cited answer or escalation — every step visible.</p></div>
          </div>
          </div>
        </section>
        <section className="mx-auto max-w-4xl px-6 py-12">
          <h2 className="text-2xl font-bold">Questions, answered</h2>
          <div className="mt-6 space-y-4">
          <div><p className="font-semibold text-gray-900">Is there a trial?</p><p className="mt-1 text-gray-600">Yes — the live demo workspace has a handbook KB, a support agent, and a sample run. No card required.</p></div>
          <div><p className="font-semibold text-gray-900">What does the LLM cost?</p><p className="mt-1 text-gray-600">Whatever your provider charges — you bring the key, we never mark it up. Heuristic mode costs nothing.</p></div>
          <div><p className="font-semibold text-gray-900">Will it make things up?</p><p className="mt-1 text-gray-600">It is built not to: no citation, no answer. Uncertainty escalates to a human with the transcript attached.</p></div>
          <div><p className="font-semibold text-gray-900">Can I cancel anytime?</p><p className="mt-1 text-gray-600">Yes. Plans are month-to-month; service runs to the end of your billing period.</p></div>
          </div>
        </section>
        <section className="mx-auto max-w-4xl px-6 pb-16 text-center">
          <h2 className="text-2xl font-bold">Try the live demo — no card, no call.</h2>
          <div className="mt-6 flex justify-center gap-4">
            <a href="/dashboard?workspace=demo" className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 transition">
              Open live demo
            </a>
            <Link href="/pricing" className="rounded-lg border border-gray-300 hover:bg-gray-50 px-6 py-3 font-semibold transition">
              See pricing
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
