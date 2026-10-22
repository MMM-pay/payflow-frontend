import { beforeEach, describe, expect, it, vi } from "vitest";
import { signWebhookProof } from "@/lib/sign-webhook-proof";
const kit = vi.hoisted(() => ({ getAddress: vi.fn(), getNetwork: vi.fn(), signMessage: vi.fn() }));
vi.mock("@/lib/wallet", () => ({ getKit: async () => kit }));
vi.mock("@/lib/config", () => ({ config: { networkPassphrase: "Testnet" } }));
beforeEach(() => {
  vi.resetAllMocks(); kit.getAddress.mockResolvedValue({ address: "GA" });
  kit.getNetwork.mockResolvedValue({ networkPassphrase: "Testnet" });
  kit.signMessage.mockResolvedValue({ signedMessage: "proof", signerAddress: "GA" });
});
describe("history wallet proof", () => {
  it("signs a message with the selected account and network", async () => {
    expect(await signWebhookProof("message", "GA")).toBe("proof");
    expect(kit.signMessage).toHaveBeenCalledWith("message", { address: "GA", networkPassphrase: "Testnet" });
    expect(kit.getAddress).toHaveBeenCalledTimes(2); expect(kit.getNetwork).toHaveBeenCalledTimes(2);
  });
  it("rejects an account switch before prompting", async () => {
    kit.getAddress.mockResolvedValue({ address: "GB" });
    await expect(signWebhookProof("message", "GA")).rejects.toThrow("account changed");
    expect(kit.signMessage).not.toHaveBeenCalled();
  });
  it("rejects an account switch during signing", async () => {
    kit.getAddress.mockResolvedValueOnce({ address: "GA" }).mockResolvedValueOnce({ address: "GB" });
    await expect(signWebhookProof("message", "GA")).rejects.toThrow("account changed");
  });
  it.each(["before", "after"])("rejects a wrong network %s signing", async (when) => {
    if (when === "after") kit.getNetwork.mockResolvedValueOnce({ networkPassphrase: "Testnet" });
    kit.getNetwork.mockResolvedValue({ networkPassphrase: "Mainnet" });
    await expect(signWebhookProof("message", "GA")).rejects.toThrow("correct network");
  });
  it("reports cancellation and unsupported signing", async () => {
    kit.signMessage.mockRejectedValueOnce({ code: -4 });
    await expect(signWebhookProof("message", "GA")).rejects.toThrow("You cancelled");
    kit.signMessage.mockResolvedValueOnce({ signedMessage: "" });
    await expect(signWebhookProof("message", "GA")).rejects.toThrow("supports message signing");
  });
  it("rejects a mismatched signer", async () => {
    kit.signMessage.mockResolvedValueOnce({ signedMessage: "proof", signerAddress: "GB" });
    await expect(signWebhookProof("message", "GA")).rejects.toThrow("another wallet");
  });
});
