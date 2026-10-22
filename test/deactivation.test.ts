import { describe, expect, it } from "vitest";
import { countOpenMandates, normalizeMandateStatus } from "@/lib/plans";

describe("normalizeMandateStatus", () => {
  it("extracts status string from API response", () => {
    expect(normalizeMandateStatus("Active")).toBe("Active");
    expect(normalizeMandateStatus("Paused")).toBe("Paused");
    expect(normalizeMandateStatus("Cancelled")).toBe("Cancelled");
  });

  it("extracts status string from contract state tuple", () => {
    expect(normalizeMandateStatus(["Active"])).toBe("Active");
    expect(normalizeMandateStatus(["Paused"])).toBe("Paused");
    expect(normalizeMandateStatus(["Cancelled"])).toBe("Cancelled");
  });

  it("handles null or undefined safely", () => {
    expect(normalizeMandateStatus(null)).toBe("");
    expect(normalizeMandateStatus(undefined)).toBe("");
  });
});

describe("countOpenMandates", () => {
  it("counts active and paused mandates for the target plan", () => {
    const mandates = [
      { plan_id: 1, status: "Active" },
      { plan_id: 1, status: "Paused" },
      { plan_id: 1, status: "Cancelled" },
      { plan_id: 2, status: "Active" },
      { plan_id: 1, status: "Completed" },
    ];

    expect(countOpenMandates(1, mandates)).toBe(2);
    expect(countOpenMandates(2, mandates)).toBe(1);
    expect(countOpenMandates(3, mandates)).toBe(0);
  });

  it("correctly handles contract-only mode raw status tuples", () => {
    const contractMandates = [
      { plan_id: 5, status: ["Active"] },
      { plan_id: 5, status: ["Paused"] },
      { plan_id: 5, status: ["Cancelled"] },
      { plan_id: 5, status: ["Active"] },
    ];

    expect(countOpenMandates(5, contractMandates)).toBe(3);
  });

  it("falls back to planStatsSubscriberCount when mandates array is null", () => {
    expect(countOpenMandates(10, null, 7)).toBe(7);
    expect(countOpenMandates(10, undefined, 4)).toBe(4);
    expect(countOpenMandates(10, null, null)).toBe(0);
  });

  it("returns maximum of matching mandates and planStats count", () => {
    const mandates = [
      { plan_id: 1, status: "Active" },
    ];
    // If stats report 5 subscribers (e.g. from chainPlanSubscriberCount or backend)
    expect(countOpenMandates(1, mandates, 5)).toBe(5);
  });
});
