import { describe, expect, it } from "vitest";
import {
  amountError,
  canonicalAmount,
  checkAmount,
  DECIMALS,
  formatAmount,
  formatFeeBps,
  formatPeriod,
  fromStroops,
  MAX_AMOUNT_STROOPS,
  shortAddress,
  toStroops,
  XLM,
  type AmountCheck,
} from "@/lib/format";
import {
  checkCustomPeriod,
  checkPeriodSeconds,
  MIN_PERIOD_MESSAGE,
  PERIOD_PRESETS,
  TOO_LONG_MESSAGE,
  unitFor,
} from "@/lib/period";
import { formatUsdEstimate, formatUsdcEstimate } from "@/lib/price";

/**
 * Table-driven coverage for the formatting, period and price helpers (#356).
 *
 * The helpers these tables exercise sit on the money path: every typed amount
 * reaches a contract through `toStroops`, every amount read back from chain is
 * shown through `fromStroops`, and a billing period is published as a plain
 * number of seconds. A single wrong row here misprices a mandate or publishes
 * a length nobody chose, so each table pins the happy path *and* the rejection
 * and boundary cases next to it.
 *
 * Everything is deterministic: no clock, network, wallet or oracle read is
 * involved. `formatPeriod` and the stroop helpers are pure functions, and the
 * price formatters take the oracle figures as arguments rather than fetching
 * them.
 */

const G = "GAEWDXVDI3WI35TWTZXNQ4NTRYIG6J34XPRSNKX655LBA377M5ZOCBY5";
const USDC = { symbol: "USDC", decimals: 6 };
const DAY = 86_400;
const WEEK = 604_800;
const MONTH = 2_592_000;

describe("format helpers (#356)", () => {
  describe("fromStroops", () => {
    it.each([
      { raw: "10000000", digits: 4, decimals: DECIMALS, expected: "1" },
      { raw: "9900000", digits: 4, decimals: DECIMALS, expected: "0.99" },
      { raw: "1500000", digits: 4, decimals: DECIMALS, expected: "0.15" },
      { raw: "20000000", digits: 4, decimals: DECIMALS, expected: "2" },
      { raw: "1999999", digits: 4, decimals: DECIMALS, expected: "0.1999" },
      { raw: "1999999", digits: 2, decimals: DECIMALS, expected: "0.19" },
      { raw: "1", digits: 4, decimals: DECIMALS, expected: "0" },
      { raw: "1", digits: 7, decimals: DECIMALS, expected: "0.0000001" },
      { raw: "1500000", digits: 4, decimals: 6, expected: "1.5" },
      { raw: "1500000", digits: 4, decimals: 0, expected: "1500000" },
      // 30 decimals is clamped to the 18 an i128 amount can carry, so the
      // whole amount is below one display unit and truncates to "0".
      { raw: "1500000", digits: 4, decimals: 30, expected: "0" },
      { raw: 0n, digits: 4, decimals: DECIMALS, expected: "0" },
      { raw: -9_900_000n, digits: 4, decimals: DECIMALS, expected: "-0.99" },
      // Display code must never throw on a malformed API or contract value.
      { raw: "", digits: 4, decimals: DECIMALS, expected: "0" },
      { raw: "not-a-number", digits: 4, decimals: DECIMALS, expected: "0" },
    ])("renders $raw at $decimals decimals with $digits digits as $expected", ({
      raw,
      digits,
      decimals,
      expected,
    }) => {
      expect(fromStroops(raw, digits, decimals)).toBe(expected);
    });
  });

  describe("toStroops", () => {
    it.each([
      { input: "1", decimals: DECIMALS, expected: 10_000_000n },
      { input: "0", decimals: DECIMALS, expected: 0n },
      { input: "2.5", decimals: DECIMALS, expected: 25_000_000n },
      { input: "0.1", decimals: DECIMALS, expected: 1_000_000n },
      { input: "0.0000001", decimals: DECIMALS, expected: 1n },
      { input: " 2.5 ", decimals: DECIMALS, expected: 25_000_000n },
      { input: "1.5", decimals: 6, expected: 1_500_000n },
      { input: "5", decimals: 0, expected: 5n },
      // 1 billion XLM is far beyond Number.MAX_SAFE_INTEGER once scaled.
      { input: "1000000000", decimals: DECIMALS, expected: 10_000_000_000_000_000n },
    ])("converts $input at $decimals decimals to $expected", ({ input, decimals, expected }) => {
      expect(toStroops(input, decimals)).toBe(expected);
    });

    it.each([
      { input: "", decimals: DECIMALS, message: /positive number/i },
      { input: "   ", decimals: DECIMALS, message: /positive number/i },
      { input: "abc", decimals: DECIMALS, message: /positive number/i },
      { input: "-1", decimals: DECIMALS, message: /positive number/i },
      { input: "+1", decimals: DECIMALS, message: /positive number/i },
      { input: "1e5", decimals: DECIMALS, message: /positive number/i },
      { input: "1.2.3", decimals: DECIMALS, message: /positive number/i },
      { input: "1,5", decimals: DECIMALS, message: /positive number/i },
      { input: ".5", decimals: DECIMALS, message: /positive number/i },
      { input: "1.", decimals: DECIMALS, message: /positive number/i },
      { input: "1.00000001", decimals: DECIMALS, message: /decimal places/i },
      { input: "1.0000001", decimals: 6, message: /at most 6 decimal places/i },
      { input: "5.5", decimals: 0, message: /at most 0 decimal places/i },
    ])(
      "rejects $input instead of silently rounding it",
      ({ input, decimals, message }) => {
        expect(() => toStroops(input, decimals)).toThrow(message);
      },
    );
  });

  describe("formatAmount", () => {
    it.each([
      { raw: "1500000", meta: USDC, expected: "1.5 USDC" },
      { raw: "1500000", meta: XLM, expected: "0.15 XLM" },
      { raw: 0n, meta: USDC, expected: "0 USDC" },
      { raw: "1", meta: { symbol: "TKN", decimals: 0 }, expected: "1 TKN" },
    ])("labels $raw with the amount's own token", ({ raw, meta, expected }) => {
      expect(formatAmount(raw, meta)).toBe(expected);
    });
  });

  describe("formatFeeBps", () => {
    it.each([
      { bps: 0, expected: "0%" },
      { bps: 1, expected: "0.01%" },
      { bps: 5, expected: "0.05%" },
      { bps: 100, expected: "1%" },
      { bps: 250, expected: "2.5%" },
      { bps: 1_000, expected: "10%" },
      // An unknown rate reads as no fee, never as "NaN%".
      { bps: -100, expected: "0%" },
      { bps: Number.NaN, expected: "0%" },
    ])("renders $bps bps as $expected", ({ bps, expected }) => {
      expect(formatFeeBps(bps)).toBe(expected);
    });
  });

  describe("shortAddress", () => {
    it.each([
      { address: "GABC", size: 4, expected: "GABC" },
      { address: G, size: 4, expected: "GAEW…CBY5" },
      { address: G, size: 6, expected: "GAEWDX…5ZOCBY5" },
      // 4 + 4 + the ellipsis is still shorter than the input: leave it alone.
      { address: "GABCDEFGHIJ", size: 4, expected: "GABCDEFGHIJ" },
    ])("shortens $address at $size characters", ({ address, size, expected }) => {
      expect(shortAddress(address, size)).toBe(expected);
    });
  });

  describe("formatPeriod", () => {
    it.each([
      { seconds: 1, expected: "every 1s" },
      { seconds: 60, expected: "per minute" },
      { seconds: 90, expected: "every 90s" },
      { seconds: 120, expected: "every 2 minutes" },
      { seconds: 3_600, expected: "per hour" },
      { seconds: 7_200, expected: "every 2 hours" },
      { seconds: DAY, expected: "per day" },
      { seconds: 2 * DAY, expected: "every 2 days" },
      { seconds: WEEK, expected: "per week" },
      { seconds: 2 * WEEK, expected: "every 2 weeks" },
      { seconds: MONTH, expected: "per month" },
      // A custom quarterly plan reads on the same 30-day scale as the monthly
      // preset rather than as 90 days.
      { seconds: 3 * MONTH, expected: "every 3 months" },
      { seconds: 31_536_000, expected: "per year" },
      { seconds: 63_072_000, expected: "every 2 years" },
      { seconds: 0, expected: "every 0s" },
      { seconds: -60, expected: "every -60s" },
    ])("renders $seconds seconds as $expected", ({ seconds, expected }) => {
      expect(formatPeriod(seconds)).toBe(expected);
    });
  });

  describe("canonicalAmount", () => {
    it.each([
      { input: "1,234.5", locale: undefined, expected: "1234.5" },
      { input: "1.234,5", locale: undefined, expected: "1234.5" },
      { input: "1,5", locale: undefined, expected: "1.5" },
      { input: "1.5", locale: undefined, expected: "1.5" },
      { input: "1,234", locale: undefined, expected: "1234" },
      { input: "1.234.567", locale: undefined, expected: "1234567" },
      { input: ".5", locale: undefined, expected: "0.5" },
      { input: "1 234,5", locale: undefined, expected: "1234.5" },
      // English always treats the dot as the decimal mark.
      { input: "1.234", locale: "en-GB", expected: "1.234" },
      // French commas are decimal marks, dots group thousands.
      { input: "1,5", locale: "fr", expected: "1.5" },
      { input: "1.234,5", locale: "fr", expected: "1234.5" },
      // Not a single number: malformed grouping, letters, empty.
      { input: "1,2,3", locale: undefined, expected: null },
      { input: "1,2,3", locale: "fr", expected: null },
      { input: "abc", locale: undefined, expected: null },
      { input: "", locale: undefined, expected: null },
    ])("canonicalises $input ($locale) to $expected", ({ input, locale, expected }) => {
      expect(canonicalAmount(input, locale)).toBe(expected);
    });
  });

  describe("checkAmount", () => {
    const cases: Array<{ input: string; decimals: number; expected: AmountCheck }> = [
      { input: "1", decimals: DECIMALS, expected: { ok: true, stroops: 10_000_000n } },
      // A trailing dot is a numeric keypad mid-keystroke, not an error.
      { input: "1.", decimals: DECIMALS, expected: { ok: true, stroops: 10_000_000n } },
      { input: "2.5", decimals: 6, expected: { ok: true, stroops: 2_500_000n } },
      { input: "0.0000001", decimals: DECIMALS, expected: { ok: true, stroops: 1n } },
      { input: "", decimals: DECIMALS, expected: { ok: false, message: "Enter an amount." } },
      { input: "   ", decimals: DECIMALS, expected: { ok: false, message: "Enter an amount." } },
      {
        input: "abc",
        decimals: DECIMALS,
        expected: { ok: false, message: "Enter a positive number, for example 2.5." },
      },
      {
        input: "0",
        decimals: DECIMALS,
        expected: { ok: false, message: "Amount must be greater than zero." },
      },
      {
        input: "0.0",
        decimals: DECIMALS,
        expected: { ok: false, message: "Amount must be greater than zero." },
      },
      {
        input: "1.00000001",
        decimals: DECIMALS,
        expected: { ok: false, message: `At most ${DECIMALS} decimal places.` },
      },
      {
        input: "1.0000001",
        decimals: 6,
        expected: { ok: false, message: "At most 6 decimal places." },
      },
      { input: "0.5", decimals: 0, expected: { ok: false, message: "At most 0 decimal places." } },
      {
        input: MAX_AMOUNT_STROOPS.toString(),
        decimals: 0,
        expected: { ok: true, stroops: MAX_AMOUNT_STROOPS },
      },
      {
        input: (MAX_AMOUNT_STROOPS + 1n).toString(),
        decimals: 0,
        expected: { ok: false, message: "Amount is too large." },
      },
    ];

    it.each(cases)("validates $input at $decimals decimals", ({ input, decimals, expected }) => {
      expect(checkAmount(input, decimals)).toEqual(expected);
    });
  });

  describe("amountError", () => {
    it.each([
      { input: "", decimals: DECIMALS, expected: null },
      { input: "1,234.5", decimals: DECIMALS, expected: null },
      { input: "1.234,5", decimals: DECIMALS, expected: null },
      // A bare trailing separator is still being typed.
      { input: "12.", decimals: DECIMALS, expected: null },
      { input: ",5", decimals: DECIMALS, expected: null },
      { input: "abc", decimals: DECIMALS, expected: "Enter a positive number, for example 2.5" },
      { input: "1,00000001", decimals: DECIMALS, expected: "At most 7 decimal places" },
      { input: "1,5", decimals: 0, expected: "At most 0 decimal places" },
      {
        input: (MAX_AMOUNT_STROOPS + 1n).toString(),
        decimals: 0,
        expected: "Amount is too large.",
      },
    ])("reports on $input as $expected", ({ input, decimals, expected }) => {
      expect(amountError(input, decimals)).toBe(expected);
    });
  });
});

describe("period helpers (#356)", () => {
  describe("PERIOD_PRESETS", () => {
    it.each([
      { label: "Every minute (demo)", seconds: 60 },
      { label: "Daily", seconds: DAY },
      { label: "Weekly", seconds: WEEK },
      { label: "Monthly", seconds: MONTH },
      { label: "Yearly", seconds: 31_536_000 },
    ])("keeps the $label preset at $seconds seconds", ({ label, seconds }) => {
      expect(PERIOD_PRESETS).toContainEqual({ label, value: seconds });
    });
  });

  describe("unitFor", () => {
    it.each<[string | null | undefined, number]>([
      ["day", DAY],
      ["week", WEEK],
      ["month", MONTH],
      // An unknown select value must not become a period of zero seconds.
      ["fortnight", DAY],
      [null, DAY],
      [undefined, DAY],
    ])("resolves %s to %i seconds", (name, seconds) => {
      expect(unitFor(name).seconds).toBe(seconds);
    });
  });

  describe("checkPeriodSeconds", () => {
    it.each([
      { seconds: 60, expected: { ok: true, seconds: 60 } },
      { seconds: 61, expected: { ok: true, seconds: 61 } },
      { seconds: DAY, expected: { ok: true, seconds: DAY } },
      { seconds: 59, expected: { ok: false, message: MIN_PERIOD_MESSAGE } },
      { seconds: 0, expected: { ok: false, message: MIN_PERIOD_MESSAGE } },
      { seconds: -60, expected: { ok: false, message: MIN_PERIOD_MESSAGE } },
      // NaN and infinity are not periods the contract could store; the finite
      // check names them with the floor message rather than "too long".
      { seconds: Number.NaN, expected: { ok: false, message: MIN_PERIOD_MESSAGE } },
      {
        seconds: Number.POSITIVE_INFINITY,
        expected: { ok: false, message: MIN_PERIOD_MESSAGE },
      },
      // Beyond 2^53 a `number` cannot carry whole seconds exactly.
      { seconds: 2 ** 53, expected: { ok: false, message: TOO_LONG_MESSAGE } },
      { seconds: 90.5, expected: { ok: false, message: TOO_LONG_MESSAGE } },
    ])("checks $seconds seconds", ({ seconds, expected }) => {
      expect(checkPeriodSeconds(seconds)).toEqual(expected);
    });
  });

  describe("checkCustomPeriod", () => {
    it.each([
      { count: "14", unit: "day", expected: { ok: true, seconds: 14 * DAY } },
      { count: "2", unit: "week", expected: { ok: true, seconds: 2 * WEEK } },
      { count: "3", unit: "month", expected: { ok: true, seconds: 3 * MONTH } },
      { count: " 14 ", unit: "day", expected: { ok: true, seconds: 14 * DAY } },
      // 2 weeks and 14 days describe the same mandate length.
      { count: "2", unit: "week", expected: { ok: true, seconds: 14 * DAY } },
      // An unknown unit falls back to days instead of undefined seconds.
      { count: "10", unit: "fortnight", expected: { ok: true, seconds: 10 * DAY } },
      { count: "0", unit: "day", expected: { ok: false, message: MIN_PERIOD_MESSAGE } },
      { count: "0", unit: "month", expected: { ok: false, message: MIN_PERIOD_MESSAGE } },
      {
        count: "",
        unit: "day",
        expected: { ok: false, message: "Enter a whole number of days." },
      },
      {
        count: "  ",
        unit: "week",
        expected: { ok: false, message: "Enter a whole number of weeks." },
      },
      {
        count: "1.5",
        unit: "day",
        expected: { ok: false, message: "Enter a whole number of days." },
      },
      {
        count: "1e4",
        unit: "day",
        expected: { ok: false, message: "Enter a whole number of days." },
      },
      {
        count: "renewal",
        unit: "day",
        expected: { ok: false, message: "Enter a whole number of days." },
      },
      {
        count: "-3",
        unit: "week",
        expected: { ok: false, message: "Enter a positive number of weeks." },
      },
      {
        count: "99999999999999999999",
        unit: "day",
        expected: { ok: false, message: TOO_LONG_MESSAGE },
      },
    ])("converts $count $unit(s)", ({ count, unit, expected }) => {
      expect(checkCustomPeriod(count, unit)).toEqual(expected);
    });
  });
});

describe("price helpers (#356)", () => {
  // 18_157_275_929_256 with 14 oracle decimals is ~$0.18157 per XLM.
  const XLM_PRICE = 18_157_275_929_256n;
  const ORACLE_DECIMALS = 14;

  describe("formatUsdEstimate", () => {
    it.each([
      { amount: 0n, price: XLM_PRICE, oracle: 14, token: 7, expected: "$0.00" },
      { amount: -100n, price: XLM_PRICE, oracle: 14, token: 7, expected: "$0.00" },
      { amount: 100_000n, price: XLM_PRICE, oracle: 14, token: 7, expected: "< $0.01" },
      { amount: 100_000_000n, price: XLM_PRICE, oracle: 14, token: 7, expected: "$1.82" },
      { amount: 1_000_000_000n, price: XLM_PRICE, oracle: 14, token: 7, expected: "$18.16" },
      { amount: "100000000", price: XLM_PRICE, oracle: 14, token: 7, expected: "$1.82" },
      { amount: 100_000_000, price: XLM_PRICE, oracle: 14, token: 7, expected: "$1.82" },
      // A 6-decimal token at a $1.00 oracle price: 1 USDC is exactly $1.00.
      {
        amount: 1_000_000n,
        price: 100_000_000_000_000n,
        oracle: ORACLE_DECIMALS,
        token: 6,
        expected: "$1.00",
      },
      // An unavailable oracle must not render a price.
      { amount: 100_000_000n, price: 0n, oracle: 14, token: 7, expected: "$0.00" },
    ])(
      "formats $amount at oracle $price / 10^$oracle and token 10^-$token as $expected",
      ({ amount, price, oracle, token, expected }) => {
        expect(formatUsdEstimate(amount, price, oracle, token)).toBe(expected);
      },
    );
  });

  describe("formatUsdcEstimate", () => {
    it.each([
      { amount: 1_000_000n, decimals: 6, expected: "$1.00" },
      { amount: 15_500_000n, decimals: 6, expected: "$15.50" },
      { amount: 100n, decimals: 6, expected: "< $0.01" },
      { amount: 0n, decimals: 6, expected: "$0.00" },
      { amount: -5n, decimals: 6, expected: "$0.00" },
      { amount: "1000000", decimals: 6, expected: "$1.00" },
      { amount: 1_000_000n, decimals: 0, expected: "$1000000.00" },
    ])("formats $amount with $decimals decimals as $expected", ({
      amount,
      decimals,
      expected,
    }) => {
      expect(formatUsdcEstimate(amount, decimals)).toBe(expected);
    });
  });
});
