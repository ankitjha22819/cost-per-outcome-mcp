import { describe, expect, it } from "vitest";
import { groupRequests } from "../src/analysis/requests.js";
import { makeCall } from "./helpers.js";

describe("groupRequests", () => {
  it("groups calls by request_id, sorts by attempt, and sums cost", () => {
    const [g] = groupRequests([
      makeCall({ request_id: "a", attemptN: 2, status: "ok", outcome: "success", totalCostUsd: 2 }),
      makeCall({ request_id: "a", attemptN: 1, status: "timeout", totalCostUsd: 1 }),
    ]);
    expect(g?.calls.map((c) => c.attemptN)).toEqual([1, 2]);
    expect(g?.totalCostUsd).toBe(3);
    expect(g).toMatchObject({ request_id: "a", success: true, outcomeInferred: false });
  });

  it("uses outcome on the final attempt when present", () => {
    const [g] = groupRequests([makeCall({ request_id: "a", status: "ok", outcome: "failure" })]);
    expect(g).toMatchObject({ success: false, outcomeInferred: false });
  });

  it("falls back to final status ok when outcome is missing, and flags it", () => {
    const groups = groupRequests([
      makeCall({ request_id: "ok", status: "ok" }),
      makeCall({ request_id: "bad", status: "error" }),
    ]);
    expect(groups.map((g) => [g.request_id, g.success, g.outcomeInferred])).toEqual([
      ["ok", true, true],
      ["bad", false, true],
    ]);
  });
});
