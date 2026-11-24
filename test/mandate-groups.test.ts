import { describe, expect, it } from "vitest";
import { groupMandatesByStatus, mandateGroup } from "@/lib/mandate-status";

const at = (id: number, status: unknown) => ({ id, status });

describe("subscription grouping by status (#297)", () => {
  it("puts active and paused mandates in their own groups", () => {
    expect(mandateGroup("Active")).toBe("active");
    expect(mandateGroup("Paused")).toBe("paused");
    expect(mandateGroup(["Active"])).toBe("active");
    expect(mandateGroup(["Paused"])).toBe("paused");
  });

  it("treats cancelled, completed and unknown statuses as ended", () => {
    expect(mandateGroup("Cancelled")).toBe("ended");
    expect(mandateGroup("Completed")).toBe("ended");
    expect(mandateGroup(["Cancelled"])).toBe("ended");
    expect(mandateGroup("SomeFutureStatus")).toBe("ended");
    expect(mandateGroup(null)).toBe("ended");
  });

  it("returns the three sections in scan order and preserves input order", () => {
    const groups = groupMandatesByStatus([
      at(1, "Cancelled"),
      at(2, "Active"),
      at(3, "Paused"),
      at(4, "Active"),
      at(5, "Completed"),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["active", "paused", "ended"]);
    expect(groups[0]!.mandates.map((m) => m.id)).toEqual([2, 4]);
    expect(groups[1]!.mandates.map((m) => m.id)).toEqual([3]);
    expect(groups[2]!.mandates.map((m) => m.id)).toEqual([1, 5]);
  });

  it("returns empty sections rather than omitting them", () => {
    const groups = groupMandatesByStatus([at(1, "Active")]);
    expect(groups).toHaveLength(3);
    expect(groups[1]!.mandates).toEqual([]);
    expect(groups[2]!.mandates).toEqual([]);
  });
});
