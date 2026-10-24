import { describe, expect, it } from "vitest";
import { qrMatrix, qrPath } from "@/lib/qr";

/**
 * The QR code of a share link (issue #19). The code is scanned by a phone
 * camera, so the tests check the structure a scanner relies on: the three
 * finder patterns in the corners, the timing pattern, and that the path
 * covers exactly the dark modules.
 */

const URL = "https://mmm-pay.github.io/payflow-frontend/subscribe/?plan=12";

describe("qrMatrix", () => {
  it("is a square grid", () => {
    const modules = qrMatrix(URL);
    expect(modules.length).toBeGreaterThanOrEqual(21);
    for (const row of modules) expect(row.length).toBe(modules.length);
  });

  it("puts a finder pattern in every corner", () => {
    const modules = qrMatrix(URL);
    const last = modules.length - 1;
    // The top-left of each 7×7 finder block.
    const corners: Array<[number, number]> = [
      [0, 0],
      [0, last - 6],
      [last - 6, 0],
    ];
    for (const [row, col] of corners) {
      // A finder pattern: a dark 7×7 border with a dark 3×3 centre.
      expect(modules[row]?.[col]).toBe(true);
      expect(modules[row + 1]?.[col + 1]).toBe(false);
      expect(modules[row + 3]?.[col + 3]).toBe(true);
      expect(modules[row + 6]?.[col + 6]).toBe(true);
    }
  });

  it("puts a timing pattern along the row below the first finder", () => {
    const modules = qrMatrix(URL);
    // The timing pattern alternates dark and light, starting and ending dark.
    for (let col = 8; col < modules.length - 8; col += 1) {
      expect(modules[6]?.[col]).toBe(col % 2 === 0);
    }
  });

  it("encodes different links differently", () => {
    expect(qrPath(qrMatrix(URL))).not.toBe(qrPath(qrMatrix(`${URL}1`)));
  });
});

describe("qrPath", () => {
  it("draws every dark module and no other", () => {
    const modules = qrMatrix(URL);
    const dark = modules.flat().filter(Boolean).length;
    const path = qrPath(modules);
    expect(path.split("M").length - 1).toBe(dark);
    expect(path).not.toContain("NaN");
  });

  it("is empty for a code without dark modules", () => {
    expect(qrPath([[false, false], [false, false]])).toBe("");
  });
});
