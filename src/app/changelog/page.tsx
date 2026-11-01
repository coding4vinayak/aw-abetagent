import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "@/components/site";

export const metadata: Metadata = {
  title: "Changelog — AbetAgent",
  description: "What changed in AbetAgent, newest first.",
};

export default function Page() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Changelog</h1>
        <p className="mt-2 text-gray-600">Newest first. Breaking changes are marked <strong>BREAKING</strong> and get 30 days&apos; notice here before they ship.</p>
        <div className="mt-8 space-y-8 border-l-2 border-blue-600 pl-6">
          <div>
            <p className="text-sm text-muted">November 2026</p>
            <h2 className="text-lg font-bold">v1.3.1 — Deliveries a receiver can age out and dedupe</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>Outbound deliveries now carry <code>X-Webhook-Timestamp</code> and <code>X-Webhook-Delivery</code> beside the signature headers. A receiver on the nuCRM side — whose plugin endpoint enforces a 5-minute freshness window only when the timestamp header is present, and skips the check when it is not — now refuses a stale re-send instead of accepting it a second time.</li>
              <li><code>X-Webhook-Delivery</code> is the payload <code>id</code>, which lives inside the signed body: a receiver that remembers delivery ids rejects a duplicate arrival, and a replayer cannot hand it a new one without breaking the signature. The bytes signed and the headers already verified are unchanged.</li>
            </ul>
          </div>
          <div>
            <p className="text-sm text-muted">October 2026</p>
            <h2 className="text-lg font-bold">v1.3.0 — Also in the Abetworks suite</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>The pricing page now says what the suite is: every product is sold standalone, and one contract can set up a workspace across all of them.</li>
              <li>It names the three products teams pair this one with, each linking to its own sign-up and saying what it costs &mdash; so a buyer reading this page is a buyer the team could have had a different conversation with.</li>
            </ul>
          </div>
          <div>
            <p className="text-sm text-gray-600">October 2026</p>
            <h2 className="text-lg font-bold">v1.2.0 — See the answer cite its source</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
              <li>An empty workspace can load a sample agent in one click: an example support agent, a two-page handbook, and one question it answers from it — with the step trace and the citation, because the run is the real runner and the answer is the engine's own.</li>
              <li>No API key is needed for that first run: the sample agent carries no model, so it answers from the approved sources and escalates when they do not hold the answer.</li>
              <li>One click removes the sample agent, its handbook, its documents and its runs.</li>
            </ul>
          </div>
          <div>
            <p className="text-sm text-gray-600">October 2026</p>
            <h2 className="text-lg font-bold">v1.1.0 — Take the audit trail with you</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
              <li>Owners and admins can download a workspace JSON with agents, prompts, tools, knowledge-base documents and chunks, team, invitations and webhook destinations.</li>
              <li>Run audits download as a streamed CSV: one row per run with its complete ordered step trace. Tool and webhook signing secrets, API keys and invitation tokens are never included.</li>
            </ul>
          </div>
          <div>
            <p className="text-sm text-gray-600">September 2026</p>
            <h2 className="text-lg font-bold">v1.0.0 — Initial public release</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
              <li>General availability: Define an agent, give it your approved sources, and it retrieves, reasons in a visible step trace, answers with citations — and escalates to a human instead of bluffing.</li>
              <li>Public pricing, terms, privacy, and support pages.</li>
              <li>Live demo workspace, no card required.</li>
            </ul>
          </div>
        </div>
        <p className="mt-8 text-gray-600">How we version: <code>major.minor.patch</code>. Minor adds features, patch fixes bugs, major is reserved for contract changes — and those are announced here first.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
