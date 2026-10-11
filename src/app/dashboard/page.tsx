import Link from "next/link";
import { prisma } from "@/lib/db";
import { DashboardShell } from "@/components/dashboard-shell";
import { resolveWorkspace } from "@/lib/resolve-workspace";
import { signOut } from "@/app/auth-actions";
import { switchWorkspaceAction } from "@/app/member-actions";
import { createFirstKey } from "@/app/key-actions";
import { ApiKeyOnboarding } from "@/components/api-key-onboarding";

export const dynamic = "force-dynamic";

function Badge({ tone, children }: { tone: "green" | "blue" | "red" | "gray"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: "bg-green-100 text-green-800",
    blue: "bg-blue-100 text-blue-800",
    red: "bg-red-100 text-red-800",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function runTone(status: string): "green" | "blue" | "red" | "gray" {
  if (status === "COMPLETED") return "green";
  if (status === "ESCALATED") return "blue";
  if (status === "FAILED") return "red";
  return "gray";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const { workspace: requestedSlug } = await searchParams;
  // One policy, shared: the demo stays public, a customer's own workspace needs
  // their session, and naming anyone else's slug is refused rather than served.
  const resolved = await resolveWorkspace(requestedSlug);
  if (!resolved.workspace) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-gray-600">
            That workspace needs an account. Sign in to open yours.
          </p>
          <a
            href="/login"
            className="mt-4 inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Sign in
          </a>
        </div>
      </main>
    );
  }
  const workspace = resolved.workspace;
  const session = resolved.session;

  // The bar's workspace switcher needs the full list. Anonymous visitors get
  // none — the demo badge already says what they are looking at.
  const myWorkspaces = session
    ? await prisma.membership.findMany({
        where: { userId: session.userId },
        include: { workspace: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const liveKeyCount = session
    ? await prisma.apiKey.count({ where: { workspaceId: workspace.id, revokedAt: null } })
    : null;

  const [agents, runs, totalRuns, completed, escalated] = await Promise.all([
    prisma.agent.findMany({
      where: { workspaceId: workspace.id },
      include: { _count: { select: { runs: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.run.findMany({
      where: { workspaceId: workspace.id },
      include: { agent: { select: { name: true } }, _count: { select: { steps: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.run.count({ where: { workspaceId: workspace.id } }),
    prisma.run.count({ where: { workspaceId: workspace.id, status: "COMPLETED" } }),
    prisma.run.count({ where: { workspaceId: workspace.id, status: "ESCALATED" } }),
  ]);

  return (
    <DashboardShell
      product="AbetAgent"
      accent="text-purple-600"
      accentSoft="bg-purple-500"
      account={
        session
          ? {
              name: session.name,
              email: session.email,
              signOut,
              workspaces: myWorkspaces.map((m) => m.workspace),
              currentWorkspaceId: session.workspaceId,
              switchWorkspace: switchWorkspaceAction,
            }
          : null
      }
      workspace={workspace.name}
      title="Agent dashboard"
    >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card label="Agents" value={agents.length} />
          <Card label="Runs" value={totalRuns} sub="all time, all statuses" />
          <Card label="Completed" value={completed} />
          <Card label="Escalated" value={escalated} sub="handed to a human, not a failure" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Agents</h2>
          {agents.length === 0 ? (
            <p className="text-sm text-gray-500">No agents yet. Create one via <code>POST /api/agents</code>.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Model</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="py-3 pr-4 font-medium text-gray-900">{a.name}</td>
                      <td className="py-3 pr-4 text-gray-600">{a.model || "heuristic"}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={a.status === "ACTIVE" ? "green" : "gray"}>{a.status}</Badge>
                      </td>
                      <td className="py-3 text-gray-600">{a._count.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-500">No runs yet. Start one via <code>POST /api/agents/{'{id}'}/runs</code>.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-2 pr-4 font-medium">Agent</th>
                    <th className="pb-2 pr-4 font-medium">Input</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="py-3 pr-4 font-medium text-gray-900">{r.agent.name}</td>
                      <td className="py-3 pr-4 text-gray-600 max-w-xs truncate">{r.input}</td>
                      <td className="py-3 pr-4"><Badge tone={runTone(r.status)}>{r.status}</Badge></td>
                      <td className="py-3 text-gray-600">{r._count.steps}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      {session && liveKeyCount === 0 && (
        // Only for a signed-in workspace with no usable key: a stranger on the
        // public demo has no account to attach a key to, and prompting them
        // would be an invitation to sign up mid-demo.
        <div className="mt-6">
          <ApiKeyOnboarding createKey={createFirstKey} />
        </div>
      )}
      </DashboardShell>
  );
}
