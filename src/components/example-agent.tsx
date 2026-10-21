"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The sample agent's two buttons: load it, and take it away again.
 *
 * It talks to `/api/example-data` over the session and then asks the server to
 * re-render, so what appears on screen is the answer the engine produced —
 * with its steps and its citation — and not anything this component invented.
 */
export function ExampleAgent({ loaded }: { loaded: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function call(method: "POST" | "DELETE") {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/example-data", { method });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || "Could not reach the server.");
          return;
        }
        router.refresh();
      } catch {
        setError("Network error — try again.");
      }
    });
  }

  if (loaded) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span>
          <strong>Sample agent.</strong> Its handbook is about an imaginary company — the answer, the
          steps and the citation are the agent&rsquo;s own.
        </span>
        <button
          type="button"
          onClick={() => call("DELETE")}
          disabled={pending}
          className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
        >
          {pending ? "Working…" : "Remove the sample"}
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => call("POST")}
        disabled={pending}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Loading…" : "Load a sample agent"}
      </button>
      <p className="mt-2 text-xs text-gray-500">
        An example support agent with a two-page handbook, and one question it answers from it — with
        the source it used. No API key needed, and one click removes it again.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
