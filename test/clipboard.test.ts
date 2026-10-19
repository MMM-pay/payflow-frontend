import { describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * The displayed address is truncated, so the only thing that makes the copy
 * button useful is that it receives the full value. These tests also cover the
 * fallback used when the async Clipboard API is unavailable or denied.
 */

const FULL_ADDRESS = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";

describe("copyToClipboard", () => {
  it("copies the full value, not the shortened display form", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn(() => true);

    await expect(
      copyToClipboard(FULL_ADDRESS, { clipboard: { writeText }, fallback }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(FULL_ADDRESS);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back when the clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const fallback = vi.fn(() => true);

    await expect(
      copyToClipboard(FULL_ADDRESS, { clipboard: { writeText }, fallback }),
    ).resolves.toBe(true);

    expect(fallback).toHaveBeenCalledWith(FULL_ADDRESS);
  });

  it("uses the fallback when no clipboard API exists", async () => {
    const fallback = vi.fn(() => true);

    await expect(copyToClipboard(FULL_ADDRESS, { clipboard: null, fallback })).resolves.toBe(
      true,
    );

    expect(fallback).toHaveBeenCalledWith(FULL_ADDRESS);
  });

  it("reports failure instead of throwing when both paths fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const fallback = vi.fn(() => {
      throw new Error("unsupported");
    });

    await expect(
      copyToClipboard(FULL_ADDRESS, { clipboard: { writeText }, fallback }),
    ).resolves.toBe(false);
  });
});
