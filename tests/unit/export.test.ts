// The export surface, pinned without a database.
//
// The route scanner proves the handlers authenticate. This file owns the parts
// a request would not make obvious: the filename cannot carry a header, a tool
// config loses its signing secret, the run audit keeps its ordered trace, user
// text cannot become a spreadsheet formula, and the JSON builder does not
// quietly select a credential column.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  exportDownloadHeaders,
  exportFilename,
  runCsvHeader,
  runCsvRow,
  toolConfigForExport,
} from "../../src/lib/export";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Minimal RFC 4180 reader for one encoded line; CRLF inside a cell is not in these fixtures. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

describe("export filenames", () => {
  it("sanitises a slug before it reaches Content-Disposition", () => {
    const name = exportFilename('Acme "EU"/Ops\r\n', "workspace", new Date("2026-10-20T12:00:00Z"));
    assert.equal(name, "abetagent-acme-eu-ops-workspace-2026-10-20.json");
    assert.equal(
      exportFilename("", "runs", new Date("2026-10-20T12:00:00Z")),
      "abetagent-workspace-runs-2026-10-20.csv",
    );
  });

  it("marks every download no-store and nosniff", () => {
    const headers = exportDownloadHeaders("abetagent-acme-runs-2026-10-20.csv", "text/csv; charset=utf-8");
    assert.equal(headers["content-disposition"], 'attachment; filename="abetagent-acme-runs-2026-10-20.csv"');
    assert.equal(headers["cache-control"], "no-store");
    assert.equal(headers["x-content-type-options"], "nosniff");
  });
});

describe("the tool config export", () => {
  it("keeps the destination and drops the signing secret without mutating the row", () => {
    const config = { url: "https://example.test/tool", secret: "tool_signing_secret", timeout: 10 };
    const exported = toolConfigForExport(config);
    assert.deepEqual(exported, { url: "https://example.test/tool", timeout: 10 });
    assert.equal(config.secret, "tool_signing_secret", "the caller's object must not be mutated");
  });

  it("turns a non-object config into an empty object", () => {
    assert.deepEqual(toolConfigForExport(null), {});
    assert.deepEqual(toolConfigForExport(["not", "an", "object"]), {});
  });
});

describe("the run-audit CSV", () => {
  it("has a stable header and preserves the ordered step trace", () => {
    assert.equal(
      runCsvHeader(),
      '"run_id","agent_id","agent_name","status","subject","input","output","error","created_at","started_at","completed_at","steps_json"\r\n',
    );

    const row = parseCsvLine(
      runCsvRow({
        id: "run_1",
        agentId: "agent_1",
        agentName: "Support Agent",
        status: "COMPLETED",
        subject: "WEBFORM contact",
        input: "Where is my order?",
        output: "It ships tomorrow.",
        error: null,
        createdAt: new Date("2026-03-01T12:00:00Z"),
        startedAt: new Date("2026-03-01T12:00:01Z"),
        completedAt: new Date("2026-03-01T12:00:02Z"),
        steps: [
          { position: 1, kind: "THINK", label: null, content: "Read the question.", createdAt: "2026-03-01T12:00:01.100Z" },
          { position: 2, kind: "REPLY", label: null, content: "It ships tomorrow.", createdAt: "2026-03-01T12:00:02.000Z" },
        ],
      }).replace(/\r\n$/, ""),
    );

    assert.equal(row[0], "run_1");
    assert.equal(row[1], "agent_1");
    assert.equal(row[2], "Support Agent");
    assert.equal(row[3], "COMPLETED");
    assert.equal(row[4], "WEBFORM contact");
    assert.equal(row[5], "Where is my order?");
    assert.equal(row[6], "It ships tomorrow.");
    assert.equal(row[7], "");
    assert.equal(row[8], "2026-03-01T12:00:00.000Z");
    assert.equal(row[9], "2026-03-01T12:00:01.000Z");
    assert.equal(row[10], "2026-03-01T12:00:02.000Z");
    assert.deepEqual(JSON.parse(row[11]), [
      { position: 1, kind: "THINK", label: null, content: "Read the question.", createdAt: "2026-03-01T12:00:01.100Z" },
      { position: 2, kind: "REPLY", label: null, content: "It ships tomorrow.", createdAt: "2026-03-01T12:00:02.000Z" },
    ]);
  });

  it("quotes newlines and refuses to let run input become a formula", () => {
    const row = parseCsvLine(
      runCsvRow({
        id: "run_2",
        agentId: "agent_2",
        agentName: "=HYPERLINK(\"https://example.test\")",
        status: "FAILED",
        subject: null,
        input: "line one\nline two",
        output: null,
        error: "model refused",
        createdAt: "2026-03-01T12:00:00.000Z",
        startedAt: null,
        completedAt: null,
        steps: [],
      }).replace(/\r\n$/, ""),
    );

    assert.equal(row[2], "'=HYPERLINK(\"https://example.test\")");
    assert.equal(row[5], "line one\nline two");
    assert.equal(row[7], "model refused");
    assert.equal(row[9], "");
    assert.equal(row[10], "");
    assert.deepEqual(JSON.parse(row[11]), []);
  });
});

describe("the export builder's boundaries", () => {
  const builder = source("../../src/lib/export.ts");

  it("selects content, never credential columns", () => {
    for (const forbidden of [
      "secret: true",
      "tokenHash: true",
      "hashedKey: true",
      "passwordHash: true",
      "stripeCustomerId: true",
      "stripeSubscriptionId: true",
    ]) {
      assert.equal(builder.includes(forbidden), false, `${forbidden} must not be selected by an export`);
    }
  });

  it("scopes every collection query to the workspace", () => {
    const scoped = builder.match(/where:\s*\{\s*workspaceId/g) ?? [];
    assert.ok(scoped.length >= 7, `only ${scoped.length} workspace-scoped queries found — a query may be exporting another tenant's rows`);
  });

  it("keeps run rows out of the in-memory document and points at the stream", () => {
    assert.ok(builder.includes('download: "/api/export/runs"'));
    assert.ok(builder.includes("runs: runCount"), "the document carries the count");
    assert.equal(/runs:\s*\[/.test(builder), false, "run rows must not be embedded as an array");
  });

  it("every export route authenticates, checks the role, and uses the shared headers", () => {
    for (const route of [
      "../../src/app/api/export/route.ts",
      "../../src/app/api/export/runs/route.ts",
    ]) {
      const src = source(route);
      assert.match(src, /getSession\(\)/, `${route} must resolve the browser session`);
      assert.match(src, /canManageRoles\(session\.role\)/, `${route} must refuse a member`);
      assert.match(src, /exportDownloadHeaders/, `${route} must use the no-store download headers`);
    }
  });
});
