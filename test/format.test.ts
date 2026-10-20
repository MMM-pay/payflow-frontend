import { describe, expect, it } from "vitest";
import {
  amountError,
  BPS_DENOMINATOR,
  canonicalAmount,
  checkAmount,
  DECIMALS,
  feeSplit,
  formatAmount,
  formatExactTime,
  formatFeeBps,
  formatPeriod,
  formatWhen,
  fromStroops,
  MAX_FEE_BPS,
  minPauseDate,
  normaliseAmountInput,
  parseAmount,
  parsePauseDate,
  resumeDate,
  shortAddress,
  toStroops,
  XLM,
} from "@/lib/format";

/**
 * These helpers sit on the money path: every amount a user types reaches a
 * contract through `toStroops`, and every amount read back from chain is shown
 * through `fromStroops`. A rounding or parsing bug here silently misprices a
 * mandate, so the round-trip and the rejection cases are tested explicitly.
 *
 * The decimals argument is the token's, not a constant: a SEP-41 token picks
 * its own, and reading a 6-decimal amount as if it were XLM is off by 10^1.
 */

describe("toStroops", () => {
  it("converts whole numbers", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0")).toBe(0n);
    expect(toStroops("100")).toBe(1_000_000_000n);
  });

  it("converts decimals at full precision", () => {
    expect(toStroops("2.5")).toBe(25_000_000n);
    expect(toStroops("0.99")).toBe(9_900_000n);
    // One stroop is the smallest representable unit.
    expect(toStroops("0.0000001")).toBe(1n);
  });

  it("tolerates surrounding whitespace", () => {
    expect(toStroops("  2.5  ")).toBe(25_000_000n);
  });

  it("pads fractional digits rather than truncating them", () => {
    // "0.1" must be 1_000_000 stroops, not 1.
    expect(toStroops("0.1")).toBe(1_000_000n);
    expect(toStroops("0.10")).toBe(1_000_000n);
  });

  it("rejects more than seven decimal places instead of silently rounding", () => {
    expect(() => toStroops("1.00000001")).toThrow(/decimal places/);
  });

  it("rejects anything that is not a positive decimal", () => {
    for (const bad of ["", " ", "abc", "-1", "1.2.3", "1e5", "1,5", ".5", "1."]) {
      expect(() => toStroops(bad), `"${bad}" must be rejected`).toThrow();
    }
  });

  it("never loses precision on large amounts", () => {
    // 1 billion XLM — far beyond Number.MAX_SAFE_INTEGER once scaled.
    const stroops = toStroops("1000000000");
    expect(stroops).toBe(10_000_000_000_000_000n);
    expect(stroops > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});

describe("fromStroops", () => {
  it("formats whole and fractional values", () => {
    expect(fromStroops("10000000")).toBe("1");
    expect(fromStroops("9900000")).toBe("0.99");
    expect(fromStroops("25000000")).toBe("2.5");
  });

  it("accepts bigint as well as string", () => {
    expect(fromStroops(9_900_000n)).toBe("0.99");
  });

  it("treats empty and invalid input as zero rather than throwing", () => {
    // Display code must never crash on a malformed API value.
    expect(fromStroops("")).toBe("0");
    expect(fromStroops("not-a-number")).toBe("0");
  });

  it("strips trailing zeros", () => {
    expect(fromStroops("1500000")).toBe("0.15");
    expect(fromStroops("20000000")).toBe("2");
  });

  it("truncates to the requested precision without rounding up", () => {
    // 0.19999999 displays as 0.1999 at 4dp — truncation, never 0.2.
    expect(fromStroops("1999999", 4)).toBe("0.1999");
    expect(fromStroops("1999999", 2)).toBe("0.19");
  });

  it("handles negative values", () => {
    expect(fromStroops(-9_900_000n)).toBe("-0.99");
  });

  it("round-trips with toStroops", () => {
    // Every value a user can type must survive the trip to chain and back.
    for (const amount of ["0", "1", "0.99", "2.5", "1000", "0.0001", "0.0000001"]) {
      expect(fromStroops(toStroops(amount), DECIMALS), `round-trip of ${amount}`).toBe(amount);
    }
  });

  it("shows sub-display amounts as 0 rather than empty", () => {
    // One stroop is below 4dp display precision.
    expect(fromStroops("1", 4)).toBe("0");
  });
});

describe("token decimals", () => {
  it("leaves native XLM — 7 decimals — exactly as it was", () => {
    // Regression guard for issue #30: the default path must not move at all.
    expect(DECIMALS).toBe(7);
    expect(fromStroops("1500000")).toBe("0.15");
    expect(fromStroops("1500000", 4, DECIMALS)).toBe("0.15");
    expect(toStroops("0.15", DECIMALS)).toBe(1_500_000n);
    expect(toStroops("0.15")).toBe(1_500_000n);
    expect(XLM).toEqual({ symbol: "XLM", decimals: 7 });
  });

  it("formats a 6-decimal token with its own scale", () => {
    // USDC-style. Read as XLM, 1500000 would show as 0.15 instead of 1.5.
    expect(fromStroops("1500000", 4, 6)).toBe("1.5");
    expect(fromStroops("999999", 4, 6)).toBe("0.9999");
    expect(fromStroops("1", 4, 6)).toBe("0");
    expect(toStroops("1.5", 6)).toBe(1_500_000n);
    expect(toStroops("0.000001", 6)).toBe(1n);
  });

  it("round-trips a 6-decimal token at full precision", () => {
    for (const amount of ["0", "1", "0.99", "2.5", "1000", "0.000001"]) {
      expect(fromStroops(toStroops(amount, 6), 6, 6), `round-trip of ${amount}`).toBe(amount);
    }
  });

  it("caps input at the token's own precision", () => {
    // The 7th decimal is real on XLM but unrepresentable on a 6-decimal token.
    expect(() => toStroops("1.0000001", 6)).toThrow(/at most 6 decimal places/i);
    expect(() => toStroops("1.0000001", 7)).not.toThrow();
  });

  it("handles a whole-number token", () => {
    expect(fromStroops("5", 4, 0)).toBe("5");
    expect(toStroops("5", 0)).toBe(5n);
    expect(() => toStroops("5.5", 0)).toThrow(/at most 0 decimal places/i);
  });

  it("survives an absurd or missing decimals value", () => {
    // SEP-41 lets a token declare any u32; a bad one must not hang or throw.
    expect(fromStroops("1500000", 4, 0)).toBe("1500000");
    expect(fromStroops("1500000", 4, 30)).toBe("0");
    expect(fromStroops("1500000", 4, -3)).toBe("1500000");
    expect(fromStroops("1500000", 4, Number.NaN)).toBe("0.15");
    // 30 clamps to the 18 decimals an i128 amount can carry.
    expect(toStroops("1", 30)).toBe(10n ** 18n);
  });
});

describe("formatAmount", () => {
  it("labels an amount with its own token", () => {
    expect(formatAmount("1500000", { symbol: "USDC", decimals: 6 })).toBe("1.5 USDC");
    expect(formatAmount("1500000")).toBe("0.15 XLM");
    expect(formatAmount(0n, { symbol: "USDC", decimals: 6 })).toBe("0 USDC");
  });
});

describe("checkAmount", () => {
  it("accepts a positive amount and returns it in smallest units", () => {
    expect(checkAmount("1")).toEqual({ ok: true, stroops: 10_000_000n });
    expect(checkAmount("2.5")).toEqual({ ok: true, stroops: 25_000_000n });
    expect(checkAmount(" 0.99 ")).toEqual({ ok: true, stroops: 9_900_000n });
  });

  it("keeps the smallest representable amount usable", () => {
    expect(checkAmount("0.0000001")).toEqual({ ok: true, stroops: 1n });
  });

  it("treats a half-typed decimal as unfinished, not wrong", () => {
    // A numeric keypad leaves a trailing dot behind while the user types; the
    // field must stay enabled so the plan can still be published.
    expect(checkAmount("1.")).toEqual({ ok: true, stroops: 10_000_000n });
    expect(checkAmount("0.")).toEqual({ ok: false, message: expect.any(String) });
  });

  it("asks for an amount when the field is empty", () => {
    for (const empty of ["", "   "]) {
      expect(checkAmount(empty)).toEqual({
        ok: false,
        message: "Enter an amount.",
      });
    }
  });

  it("rejects text that could never be a price", () => {
    // "1,5" and "1 000" used to live here; locale-aware parsing (issue #46)
    // makes both legitimate prices, so they are accepted below instead.
    for (const bad of ["abc", "-1", "+1", "1e5", "1.2.3", "1,2,3", "0x10"]) {
      const result = checkAmount(bad);
      expect(result.ok, `"${bad}" must be rejected`).toBe(false);
    }
  });

  it("accepts the separators the user's locale uses", () => {
    // Issue #46: comma-decimal and dot-decimal spellings are the same money.
    expect(checkAmount("1,5")).toEqual({ ok: true, stroops: 15_000_000n });
    expect(checkAmount("1,234.5")).toEqual({ ok: true, stroops: 12_345_000_000n });
    expect(checkAmount("1.234,5")).toEqual({ ok: true, stroops: 12_345_000_000n });
    // A leading mark is how a comma-decimal keyboard starts a value.
    expect(checkAmount(".5")).toEqual({ ok: true, stroops: 5_000_000n });
  });

  it("rejects more decimal places than the token can represent", () => {
    const result = checkAmount("1.00000001");
    expect(result).toEqual({ ok: false, message: `At most ${DECIMALS} decimal places.` });
  });

  it("rejects zero, which the contract rejects too", () => {
    expect(checkAmount("0")).toEqual({ ok: false, message: "Amount must be greater than zero." });
    expect(checkAmount("0.0")).toEqual({
      ok: false,
      message: "Amount must be greater than zero.",
    });
  });

  it("agrees with toStroops on every input both accept", () => {
    for (const amount of ["1", "2.5", "0.99", "1000", "0.0000001"]) {
      const check = checkAmount(amount);
      expect(check.ok, `checkAmount(${amount})`).toBe(true);
      if (check.ok) expect(check.stroops, `checkAmount(${amount})`).toBe(toStroops(amount));
    }
  });

  it("reads a half-typed decimal as the amount already typed", () => {
    // toStroops rejects "1."; the form accepts it and must publish the parsed
    // value rather than re-parsing the raw string, or the click would throw.
    expect(checkAmount("1.")).toEqual({ ok: true, stroops: toStroops("1") });
  });

  it("validates against the token's decimals, not a hardcoded 7", () => {
    // A SEP-41 token picks its own scale. Capping a 6-decimal token at 7 would
    // let a merchant type a 7th place the contract cannot store.
    expect(checkAmount("1.5", 6)).toEqual({ ok: true, stroops: 1_500_000n });
    expect(checkAmount("1.0000001", 6)).toEqual({
      ok: false,
      message: "At most 6 decimal places.",
    });
    expect(checkAmount("1.0000001", 7).ok).toBe(true);
    expect(checkAmount("5.5", 0)).toEqual({ ok: false, message: "At most 0 decimal places." });
  });

  it("agrees with toStroops for the token's decimals too", () => {
    for (const decimals of [0, 2, 6, 7, 12]) {
      const check = checkAmount("12.345678", decimals);
      if (!check.ok) continue;
      expect(check.stroops).toBe(toStroops("12.345678", decimals));
    }
  });
});

describe("feeSplit", () => {
  it("matches the contract: fee is amount × bps ÷ 10 000, net is the remainder", () => {
    const s = feeSplit(10_000_000n, 100); // 1% of 1 XLM
    expect(s).toEqual({ gross: 10_000_000n, fee: 100_000n, net: 9_900_000n });
  });

  it("keeps gross exactly equal to net plus fee", () => {
    // The contract debits `amount - fee` then `fee`; if these ever disagree a
    // charge would leave dust in the subscriber's vault.
    for (const amount of [0n, 1n, 7n, 9_999_999n, 123_456_789n]) {
      for (const bps of [0, 1, 100, 250, 1_000]) {
        const s = feeSplit(amount, bps);
        expect(s.net + s.fee, `amount ${amount} at ${bps}bps`).toBe(s.gross);
        expect(s.fee, `amount ${amount} at ${bps}bps`).toBeLessThanOrEqual(s.gross);
      }
    }
  });

  it("truncates the fee toward zero like the contract's integer division", () => {
    // 1 stroop at 1% would be 0.01 stroops; the contract rounds down to 0 and
    // credits the merchant the whole stroop. Showing 0.9999999 here instead
    // would be a visible lie.
    expect(feeSplit(1n, 100)).toEqual({ gross: 1n, fee: 0n, net: 1n });
    expect(feeSplit(999n, 100).fee).toBe(9n);
  });

  it("stays exact on amounts beyond safe Number range", () => {
    // 1 billion XLM at 1%: a float would round the fee and misreport it.
    const s = feeSplit(10_000_000_000_000_000n, 100);
    expect(s.fee).toBe(100_000_000_000_000n);
    expect(s.net).toBe(9_900_000_000_000_000n);
  });

  it("charges nothing at a 0% fee", () => {
    expect(feeSplit(10_000_000n, 0)).toEqual({ gross: 10_000_000n, fee: 0n, net: 10_000_000n });
  });

  it("never produces a negative payout, even on a malformed rate", () => {
    // set_fee_bps refuses anything above MAX_FEE_BPS, so a value outside that
    // range is bad data — a preview must not render it as paying the merchant
    // into the negative.
    for (const bps of [-100, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      const s = feeSplit(1_000_000n, bps);
      expect(s.net, `rate ${bps}`).toBeGreaterThanOrEqual(0n);
      expect(s.fee).toBeLessThanOrEqual(s.gross);
    }
  });

  it("clamps the rate to the ceiling the contract accepts", () => {
    expect(feeSplit(10_000_000n, 1e9).fee).toBe(feeSplit(10_000_000n, MAX_FEE_BPS).fee);
    expect(feeSplit(10_000_000n, 1e9).fee).toBe(1_000_000n);
  });

  it("uses the same denominator the contract does", () => {
    expect(BPS_DENOMINATOR).toBe(10_000n);
  });
});

describe("formatFeeBps", () => {
  it("renders whole and fractional percentages", () => {
    expect(formatFeeBps(100)).toBe("1%");
    expect(formatFeeBps(250)).toBe("2.5%");
    expect(formatFeeBps(1_000)).toBe("10%");
    expect(formatFeeBps(0)).toBe("0%");
  });

  it("stays readable for sub-percent rates", () => {
    expect(formatFeeBps(5)).toBe("0.05%");
    expect(formatFeeBps(1)).toBe("0.01%");
  });

  it("treats an unknown rate as no fee rather than NaN%", () => {
    expect(formatFeeBps(Number.NaN)).toBe("0%");
  });
});

describe("formatPeriod", () => {
  it("names exact single periods", () => {
    expect(formatPeriod(60)).toBe("per minute");
    expect(formatPeriod(3_600)).toBe("per hour");
    expect(formatPeriod(86_400)).toBe("per day");
    expect(formatPeriod(604_800)).toBe("per week");
    expect(formatPeriod(2_592_000)).toBe("per month");
    expect(formatPeriod(31_536_000)).toBe("per year");
  });

  it("pluralises exact multiples", () => {
    expect(formatPeriod(120)).toBe("every 2 minutes");
    expect(formatPeriod(172_800)).toBe("every 2 days");
  });

  it("picks the largest unit that divides evenly", () => {
    // 2 weeks divides by week, not by day.
    expect(formatPeriod(1_209_600)).toBe("every 2 weeks");
  });

  it("falls back to seconds when no unit divides evenly", () => {
    expect(formatPeriod(90)).toBe("every 90s");
    expect(formatPeriod(1)).toBe("every 1s");
  });
});

describe("shortAddress", () => {
  const G = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";

  it("elides the middle of a Stellar address", () => {
    expect(shortAddress(G)).toBe("GAEW…CBY5");
    expect(shortAddress(G, 6)).toBe("GAEWDX…5ZOCBY5".slice(0, 6) + "…" + G.slice(-6));
  });

  it("leaves short strings untouched", () => {
    expect(shortAddress("GABC")).toBe("GABC");
  });
});

describe("formatWhen", () => {
  // Pinned clock: the words must be stable regardless of when CI runs.
  const now = Date.UTC(2026, 9, 19, 12, 0, 0);
  const at = (deltaMs: number) => Math.floor((now + deltaMs) / 1000);

  it("renders a missing timestamp as a dash", () => {
    expect(formatWhen(0, now)).toBe("—");
  });

  it("describes due and overdue charges distinctly", () => {
    expect(formatWhen(at(0), now)).toMatch(/due now|just now/);
    expect(formatWhen(at(-5 * 60_000), now)).toBe("5 minutes ago");
    expect(formatWhen(at(5 * 60_000), now)).toBe("in 5 minutes");
  });

  it("scales units upward, spelled out for reading at a glance", () => {
    // Issue #45: "in 3d" was easy to misread; the exact time lives in the
    // tooltip rendered by <TimeAgo>, not in this string.
    expect(formatWhen(at(3 * 3_600_000), now)).toBe("in 3 hours");
    expect(formatWhen(at(3 * 86_400_000), now)).toBe("in 3 days");
    expect(formatWhen(at(-2 * 86_400_000), now)).toBe("2 days ago");
  });

  it("uses the singular", () => {
    expect(formatWhen(at(60_000), now)).toBe("in 1 minute");
    expect(formatWhen(at(3_600_000), now)).toBe("in 1 hour");
    expect(formatWhen(at(-86_400_000), now)).toBe("1 day ago");
  });
});

describe("formatExactTime", () => {
  it("renders a missing timestamp as a dash", () => {
    expect(formatExactTime(0)).toBe("—");
  });

  it("renders the exact local date and time, not a relative phrase", () => {
    const ts = Math.floor(Date.UTC(2026, 9, 19, 12, 0, 0) / 1000);
    const text = formatExactTime(ts);
    expect(text).toContain("2026");
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toMatch(/in \d|ago/);
  });
});

describe("canonicalAmount / parseAmount (locale separators)", () => {
  // Issue #46: both "1.234,5" and "1,234.5" must reach the contract as the
  // same bigint. 1234.5 XLM at 7 decimals is 12_345_000_000 stroops.
  it("parses dot-decimal and comma-decimal styles to the same amount", () => {
    expect(parseAmount("1,234.5")).toBe(12_345_000_000n);
    expect(parseAmount("1.234,5")).toBe(12_345_000_000n);
    expect(parseAmount("1,5")).toBe(15_000_000n);
    expect(parseAmount("1.5")).toBe(15_000_000n);
  });

  it("treats a lone separator followed by three digits as grouping", () => {
    // "1,234" is one thousand two hundred thirty-four in both conventions.
    expect(parseAmount("1,234")).toBe(12_340_000_000n);
    expect(parseAmount("1.234.567")).toBe(12_345_670_000_000n);
  });

  it("accepts non-breaking space grouping", () => {
    expect(parseAmount("1\u00a0234,5")).toBe(12_345_000_000n);
    expect(parseAmount("1\u202f234.5")).toBe(12_345_000_000n);
  });

  it("keeps bigint precision at full length", () => {
    expect(parseAmount("1000000000")).toBe(10_000_000_000_000_000n);
    expect(parseAmount("0,0000001")).toBe(1n);
  });

  it("honours the token's decimals", () => {
    expect(parseAmount("1,5", 6)).toBe(1_500_000n);
    expect(() => parseAmount("1,00000001")).toThrow(/decimal places/);
    expect(() => toStroops("1.0000001", 6)).toThrow(/at most 6/i);
  });

  it("rejects garbage exactly like toStroops does", () => {
    for (const bad of ["", "   ", "abc", "-1", "1.2.3", "1,2,3", "1e5", "1,,"]) {
      expect(() => parseAmount(bad), `"${bad}" must be rejected`).toThrow();
      expect(canonicalAmount(bad), `"${bad}" must not canonicalise`).toBeNull();
    }
  });

  it("canonicalises to plain dot-decimal form", () => {
    expect(canonicalAmount("1,234.5")).toBe("1234.5");
    expect(canonicalAmount("1.234,5")).toBe("1234.5");
    expect(canonicalAmount("1,234")).toBe("1234");
    expect(canonicalAmount(".5")).toBe("0.5");
  });
});

describe("normaliseAmountInput", () => {
  it("keeps what the user typed", () => {
    expect(normaliseAmountInput("1,234.5")).toBe("1,234.5");
    expect(normaliseAmountInput("1.234,5")).toBe("1.234,5");
    expect(normaliseAmountInput("1,234.56")).toBe("1,234.56");
  });

  it("keeps over-precision visible so the error can explain it", () => {
    // Truncating silently would change the amount the user asked for;
    // amountError reports the extra places instead. Four decimal places can
    // only be a fraction, so this input is unambiguous even though grouping
    // makes "1,234.567" read as the whole number 1234567.
    expect(normaliseAmountInput("1,234.5678")).toBe("1,234.5678");
    expect(amountError("1,234.5678", 2)).toMatch(/at most 2 decimal places/i);
  });

  it("lets a mid-keystroke separator stand", () => {
    expect(normaliseAmountInput("1,")).toBe("1,");
    expect(normaliseAmountInput(",5")).toBe(",5");
  });

  it("drops letters and other junk", () => {
    expect(normaliseAmountInput("12a3")).toBe("123");
    expect(normaliseAmountInput("abc")).toBe("");
  });

  it("keeps a whole-number token's typed fraction so the error can explain it", () => {
    // "5.5" must never become "55" — that would silently double the amount.
    expect(normaliseAmountInput("5.5")).toBe("5.5");
    expect(amountError("5.5", 0)).toMatch(/at most 0 decimal places/i);
  });
});

describe("amountError", () => {
  it("accepts both separator styles and empty input", () => {
    expect(amountError("")).toBeNull();
    expect(amountError("1,234.5")).toBeNull();
    expect(amountError("1.234,5")).toBeNull();
    expect(amountError("1,5")).toBeNull();
  });

  it("treats a trailing separator as still being typed", () => {
    // "12." and ",5" are mid-keystroke, not errors worth a red banner.
    expect(amountError("12.")).toBeNull();
    expect(amountError(",5")).toBeNull();
  });

  it("explains why a value cannot be submitted", () => {
    expect(amountError("abc")).toMatch(/positive number/i);
    expect(amountError("1,00000001")).toMatch(/decimal places/i);
    expect(amountError("1,5", 0)).toMatch(/decimal places/i);
  });
});

describe("pause dates", () => {
  it("reads a date picker value as midnight UTC on that day", () => {
    // "Pause until 2026-10-25" resumes at the start of the 25th, and every
    // reader sees the same instant.
    expect(parsePauseDate("2026-10-25")).toBe(Date.UTC(2026, 9, 25) / 1000);
    expect(parsePauseDate("  2026-01-01  ")).toBe(Date.UTC(2026, 0, 1) / 1000);
  });

  it("rejects a value a date picker could not produce", () => {
    for (const bad of ["", "  ", "tomorrow", "2026-10", "25/10/2026", "2026-10-25T00:00"]) {
      expect(parsePauseDate(bad), `"${bad}"`).toBeNull();
    }
  });

  it("rejects a date that does not exist rather than rolling it over", () => {
    // Date.UTC happily turns 31 February into 3 March.
    expect(parsePauseDate("2026-02-31")).toBeNull();
    expect(parsePauseDate("2026-13-01")).toBeNull();
    expect(parsePauseDate("2026-00-10")).toBeNull();
    expect(parsePauseDate("2026-04-31")).toBeNull();
    expect(parsePauseDate("2024-02-29")).not.toBeNull(); // a real leap day
    expect(parsePauseDate("2026-02-29")).toBeNull(); // not a leap year
  });

  it("offers tomorrow as the earliest date, in UTC", () => {
    const now = Date.UTC(2026, 9, 25, 23, 59, 59);
    expect(minPauseDate(now)).toBe("2026-10-26");
    expect(minPauseDate(Date.UTC(2026, 9, 25, 0, 0, 0))).toBe("2026-10-26");
    // Month boundary rolls over.
    expect(minPauseDate(Date.UTC(2026, 11, 31, 12))).toBe("2027-01-01");
  });

  it("renders a future resume as a calendar date", () => {
    const now = Date.UTC(2026, 9, 25);
    expect(resumeDate(Date.UTC(2026, 9, 30) / 1000, now)).toBe("2026-10-30");
  });

  it("shows nothing for a resume that has already passed or is absent", () => {
    const now = Date.UTC(2026, 9, 25);
    expect(resumeDate(Date.UTC(2026, 9, 24) / 1000, now)).toBeNull();
    expect(resumeDate(now / 1000, now)).toBeNull();
    expect(resumeDate(null, now)).toBeNull();
    expect(resumeDate(Number.NaN, now)).toBeNull();
  });
});