import { afterEach, expect, it, vi } from "vitest";
import { chainPlans } from "@/lib/chain";
import { payflow, type Plan } from "@/lib/payflow";
const plan: Plan = { id: 1n, name: "Cohort", merchant: "merchant", token: "token", amount: 10000000n, period: 86400n, active: true };
afterEach(() => vi.restoreAllMocks());
it("preserves cutoff and reads the cap's open count", async () => {
  vi.spyOn(payflow, "nextPlanId").mockResolvedValue(2n);
  vi.spyOn(payflow, "getPlan").mockResolvedValue({ ...plan, available_until: 123n, max_subscribers: 4 });
  const read = vi.spyOn(payflow, "planSubscriberCount").mockResolvedValue(3);
  expect(await chainPlans("source")).toMatchObject([{ available_until: 123, max_subscribers: 4, subscriber_count: 3 }]);
  expect(read).toHaveBeenCalledWith("source", 1n);
});
it.each([undefined, 0])("does not call an unsupported/unlimited counter (%s)", async (cap) => {
  vi.spyOn(payflow, "nextPlanId").mockResolvedValue(2n);
  vi.spyOn(payflow, "getPlan").mockResolvedValue({ ...plan, max_subscribers: cap });
  const read = vi.spyOn(payflow, "planSubscriberCount");
  const [result] = await chainPlans("source");
  expect(result?.subscriber_count).toBeUndefined();
  expect(result?.available_until).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});
it("keeps plans when the proposed counter getter is unavailable", async () => {
  vi.spyOn(payflow, "nextPlanId").mockResolvedValue(2n);
  vi.spyOn(payflow, "getPlan").mockResolvedValue({ ...plan, max_subscribers: 4 });
  vi.spyOn(payflow, "planSubscriberCount").mockRejectedValue(new Error("unknown function"));
  const plans = await chainPlans("source");
  expect(plans).toHaveLength(1);
  expect(plans[0]?.subscriber_count).toBeUndefined();
});
