// N1: /api/agents read page/limit straight off the query string, and
// /api/agents/[id]/runs looked guarded with Math.min(parseInt(raw), 100) —
// which caps a real number and passes NaN through for "abc", because Math.min
// of NaN is NaN. Both reach Prisma, and Prisma throws: that is a 500 for a
// mistyped URL, and a full-table read for a big limit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intParam, pageParams } from "../../src/lib/pagination";

const params = (query: Record<string, string>) => new URLSearchParams(query);

describe("page and limit are bounded by the server", () => {
  it("defaults to the first page at the route's own page size", () => {
    assert.deepEqual(pageParams(new URLSearchParams(""), 20), { page: 1, limit: 20 });
  });

  it("honours a sane page and limit", () => {
    assert.deepEqual(pageParams(params({ page: "2", limit: "5" }), 20), { page: 2, limit: 5 });
  });

  it("refuses to ask for the whole table", () => {
    assert.equal(pageParams(params({ limit: "999999999" }), 20).limit, 100);
  });

  it("treats a zero or negative page as the first page, not as a negative skip", () => {
    for (const page of ["0", "-4"]) assert.equal(pageParams(params({ page }), 20).page, 1, page);
  });

  it("treats a non-numeric or zero limit as the default, never as NaN or take:0", () => {
    for (const limit of ["abc", "", "0", "-1", "  "]) {
      assert.equal(pageParams(params({ limit }), 20).limit, 20, JSON.stringify(limit));
    }
  });
});

describe("the runs cap protects the values it used to crash on", () => {
  const runsLimit = (v: string) => intParam(params({ limit: v }), "limit", 20, 1, 100);

  it("the old expression returned NaN for a non-number", () => {
    assert.equal(Math.min(Number.parseInt("abc", 10), 100), NaN, "this is what reached take:");
    assert.equal(runsLimit("abc"), 20);
    assert.equal(runsLimit("-5"), 20);
    assert.equal(runsLimit("0"), 20);
  });

  it("keeps the cap, and the caller's page size inside it", () => {
    assert.equal(runsLimit("99999"), 100);
    assert.equal(runsLimit("7"), 7);
  });
});
