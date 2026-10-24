import { describe, it, expect } from "vitest";
import {
  LABELS_STORAGE_KEY,
  MAX_LABEL_LENGTH,
  getLabel,
  normalizeLabel,
  parseLabels,
  readLabels,
  removeLabel,
  serializeLabels,
  setLabel,
  writeLabels,
  type LabelMap,
} from "@/lib/labels";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  } as Storage;
}

function blockedStorage(): Storage {
  return {
    get length(): number {
      throw new Error("blocked");
    },
    clear() {
      throw new Error("blocked");
    },
    getItem() {
      throw new Error("blocked");
    },
    key() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  } as Storage;
}

describe("normalizeLabel", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeLabel("  Acme   Corp  ")).to.eq("Acme Corp");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeLabel("   ")).to.eq("");
  });

  it("caps the length", () => {
    const long = "a".repeat(MAX_LABEL_LENGTH + 10);
    expect(normalizeLabel(long)).to.have.length(MAX_LABEL_LENGTH);
  });
});

describe("parseLabels", () => {
  it("returns an empty map for null", () => {
    expect(parseLabels(null)).to.equal({});
  });

  it("returns an empty map for invalid JSON", () => {
    expect(parseLabels("{not json")).to.equal({});
  });

  it("ignores non-object payloads", () => {
    expect(parseLabels("[]")).to.equal({});
    expect(parseLabels("\"hello\"")).to.equal({});
  });

  it("round-trips through serializeLabels", () => {
    const labels: LabelMap = { GABCDEF: "Acme" };
    expect(parseLabels(serializeLabels(labels))).to.equal(labels);
  });

  it("drops blank and non-string values", () => {
    expect(parseLabels('{"GABC":"  ","GDEF":42}')).to.equal({});
  });
});

describe("setLabel / removeLabel / getLabel", () => {
  it("sets a normalized label", () => {
    const next = setLabel({}, "GABC", "  Acme  ");
    expect(getLabel(next, "GABC")).to.eq("Acme");
  });

  it("clears the label when the input is blank", () => {
    const next = setLabel({ GABC: "Acme" }, "GABC", "");
    expect(getLabel(next, "GABC")).to.undefined();
  });

  it("does not mutate the input map", () => {
    const original: LabelMap = { GABC: "Acme" };
    setLabel(original, "GDEF", "Globex");
    removeLabel(original, "GABC");
    expect(original).to.equal({ GABC: "Acme" });
  });

  it("removes a label", () => {
    const next = removeLabel({ GABC: "Acme" }, "GABC");
    expect(next).to.equal({});
  });
});

describe("readLabels / writeLabels", () => {
  it("round-trips through memory storage", () => {
    const storage = memoryStorage();
    expect(writeLabels(storage, { GABC: "Acme" })).to.be(true);
    expect(storage.getItem(LABELS_STORAGE_KEY)).to.contain("Acme");
    expect(readLabels(storage)).to.equal({ GABC: "Acme" });
  });

  it("falls back silently when storage is blocked", () => {
    const storage = blockedStorage();
    expect(readLabels(storage)).to.equal({});
    expect(writeLabels(storage, { GABC: "Acme" })).to.be(false);
  });

  it("falls back silently when storage is missing", () => {
    expect(readLabels(null)).to.equal({});
    expect(readLabels(undefined)).to.equal({});
    expect(writeLabels(null, {})).to.be(false);
  });
});
