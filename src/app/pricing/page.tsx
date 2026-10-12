import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "@/components/site";
import { BuyButton } from "@/components/buy-button";

export const metadata: Metadata = {
  title: "Pricing — AbetAgent",
  description: "AbetAgent pricing: $99 per month.",
};

export default function Page() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <SiteNav />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
        <p className="mt-2 text-gray-600">Flat monthly price per workspace: unlimited agents, runs, and knowledge bases. LLM costs are yours — bring any OpenAI-compatible key, or run heuristic-only for free.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">Monthly</p>
            <p className="mt-2 text-4xl font-bold">$99</p>
            <p className="mt-1 text-sm text-gray-600">per month</p>
            <BuyButton priceId="FLAT_MONTHLY" label="Start 14-day free trial" />
          </div>
          <div className="rounded-2xl border-2 border-blue-600 p-6 bg-blue-50">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Annual — 2 months free</p>
            <p className="mt-2 text-4xl font-bold">$990</p>
            <p className="mt-1 text-sm text-gray-600">per month, billed yearly</p>
            <BuyButton priceId="FLAT_ANNUAL" label="Start 14-day free trial" />
          </div>
          <div className="rounded-2xl border p-6 border-gray-200 bg-white shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-gray-600">Enterprise</p>
            <p className="mt-2 text-4xl font-bold">Custom</p>
            <p className="mt-1 text-sm text-gray-600">SSO, audit exports, SLA, onboarding</p>
            <a href="mailto:support@abetworks.in?subject=AbetAgent%20enterprise" className="mt-6 block rounded-lg border border-blue-600 px-4 py-2 text-center text-sm font-semibold text-blue-600 hover:bg-blue-50 transition">Talk to us</a>
          </div>
        </div>
        <h2 className="mt-12 text-xl font-bold">Questions</h2>
        <div className="mt-4 space-y-4">
          <div><p className="font-semibold text-gray-900">Is there a trial?</p><p className="mt-1 text-gray-600">Yes, two. The live demo workspace is open to anyone, no card. And every paid plan starts with a 14-day free trial — cancel from the billing portal any time before day 14 and you are not charged.</p></div>
          <div><p className="font-semibold text-gray-900">What does the LLM cost?</p><p className="mt-1 text-gray-600">Whatever your provider charges — you bring the key, we never mark it up. Heuristic mode costs nothing.</p></div>
          <div><p className="font-semibold text-gray-900">Will it make things up?</p><p className="mt-1 text-gray-600">It is built not to: no citation, no answer. Uncertainty escalates to a human with the transcript attached.</p></div>
          <div><p className="font-semibold text-gray-900">Can I cancel anytime?</p><p className="mt-1 text-gray-600">Yes. Plans are month-to-month; service runs to the end of your billing period.</p></div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
