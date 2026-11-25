import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KNOWN_FIELDS,
  contractDrift,
  contractDriftMessage,
  getContractDrift,
  observeContractRecord,
  observeUnknownContractError,
  resetContractDrift,
  subscribeContractDrift,
} from "@/lib/contract-compat";

/**
 * Contract-version drift (issue #412): a deployment that adds fields or status
 * variants is detected from the record shape, reported as a notice, and never
 * treated as an error.
 */

const PLAN = {
  id: 1n,
  merchant: "GMERCHANT",
  name: "Pro",
  token: "CTOKEN",
  amount: 5_000_000n,
  period: 2_592_000n,
  active: true,
};

const MANDATE = {
  id: 7n,
  subscriber: "GSUB",
  plan_id: 1n,
  merchant: "GMERCHANT",
  token: "CTOKEN",
  amount: 5_000_000n,
  period: 2_592_000n,
  next_charge: 1_000n,
  last_charge: 0n,
  charges_made: 0,
  max_charges: 0,
  fee_bps: 100,
  status: ["Active"],
};

beforeEach(resetContractDrift);

describe("contractDrift", () => {
  it("accepts every field this build knows about", () => {
    for (const field of KNOWN_FIELDS.plan) {
      // Listing the field here is what keeps the known set honest.
      expect(typeof field).toBe("string");
    }
    expect(contractDrift("plan", { ...PLAN, trial: 0n, max_subscribers: 0 })).toEqual({
      newer: false,
      unknownFields: [],
      unknownStatus: null,
    });
    expect(contractDrift("mandate", MANDATE).newer).toBe(false);
  });

  it("reports a field a newer contract added", () => {
    const drift = contractDrift("plan", { ...PLAN, referral_bps: 250 });
    expect(drift.newer).toBe(true);
    expect(drift.unknownFields).toEqual(["referral_bps"]);
  });

  it("reports a status variant the app does not have copy for", () => {
    const drift = contractDrift("mandate", { ...MANDATE, status: ["Suspended"] });
    expect(drift.newer).toBe(true);
    expect(drift.unknownStatus).toBe("Suspended");
  });

  it("accepts the plain status string the indexer sends", () => {
    expect(contractDrift("mandate", { ...MANDATE, status: "PastDue" }).newer).toBe(false);
  });

  it("treats a malformed record as no evidence either way", () => {
    expect(contractDrift("plan", null).newer).toBe(false);
    expect(contractDrift("plan", "not a record").newer).toBe(false);
    expect(contractDrift("mandate", []).newer).toBe(false);
  });

  it("notices an unmapped contract error code", () => {
    observeUnknownContractError("subscription", 99);
    expect(getContractDrift().newer).toBe(true);
    expect(getContractDrift().unknownFields).toEqual(["unexpected_error"]);
  });
});

describe("contract drift store", () => {
  it("merges what several reads observed and notifies subscribers once per change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeContractDrift(listener);

    observeContractRecord("plan", PLAN);
    expect(listener).not.toHaveBeenCalled();
    expect(getContractDrift().newer).toBe(false);

    observeContractRecord("plan", { ...PLAN, referral_bps: 1 });
    observeContractRecord("mandate", { ...MANDATE, hold: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getContractDrift().unknownFields).toEqual(["hold", "referral_bps"]);

    unsubscribe();
    observeUnknownContractError("vault", 50);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("has copy only when there is drift", () => {
    expect(contractDriftMessage(getContractDrift())).toBe("");
    observeUnknownContractError("vault", 50);
    expect(contractDriftMessage(getContractDrift())).toMatch(/newer than this version/i);
  });
});
