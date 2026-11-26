import { describe, expect, it } from "vitest";
import { signingActionDescription } from "@/lib/signing-action";

describe("signingActionDescription", () => {
  it("returns human-readable descriptions for known transaction actions", () => {
    expect(signingActionDescription("create_plan")).toBe("create a recurring payment plan");
    expect(signingActionDescription("subscribe")).toBe("start a recurring subscription");
    expect(signingActionDescription("cancel")).toBe("cancel a subscription");
    expect(signingActionDescription("deposit")).toBe("deposit tokens into a vault");
    expect(signingActionDescription("refund")).toBe("refund a subscription payment");
  });

  it("formats fallback descriptions for unknown actions", () => {
    expect(signingActionDescription("custom_action")).toBe("review the custom action operation");
    expect(signingActionDescription("something_new_here")).toBe("review the something new here operation");
  });
});
