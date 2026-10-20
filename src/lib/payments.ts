import type { ApiCharge, ApiMandate } from "./api";
import type { PaymentRow } from "./csv";
import { fromStroops, type TokenMeta } from "./format";

/**
 * Pure helpers behind the subscriber's payment export.
 *
 * Payment history only exists in the indexer — the contract stores how many
 * charges a mandate has taken, not the amount, fee and hash of each — so these
 * functions take the API's charge rows and turn them into values safe to put in
 * a spreadsheet. Everything here is synchronous and React-free so it can be
 * tested directly; the account page only supplies the charges, token metadata
 * and transaction dates.
 */

/**
 * A smallest-unit amount as an exact decimal string in the token's own scale.
 *
 * `fromStroops` is given the token's full `decimals` as the display limit, so
 * no digit the token can represent is dropped: a CSV handed to an accountant
 * must not lose the last stroop, and a 6-decimal token must not be divided by
 * 10^7. Never converts through `Number`, so large balances stay exact.
 */
export function exactAmount(raw: string | bigint, decimals: number): string {
  return fromStroops(raw, decimals, decimals);
}

/** Parse a smallest-unit amount from the indexer, naming the bad field if it is malformed. */
function smallestUnit(raw: string, field: string, txHash: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new Error(
      `Could not read the ${field} of payment ${txHash}; nothing was exported.`,
    );
  }
}

/**
 * One API charge as an export row.
 *
 * `tokenContract` is passed explicitly rather than inferred from the mandate
 * because the indexer does not report a mandate's token; the caller falls back
 * to the configured token exactly as the rest of the page does. `net` is
 * computed in bigint (`amount - fee`), matching the contract's own arithmetic.
 */
export function paymentRow(
  charge: ApiCharge,
  mandate: ApiMandate,
  meta: TokenMeta,
  tokenContract: string,
  date: string,
): PaymentRow {
  const amount = smallestUnit(charge.amount, "amount", charge.tx_hash);
  const fee = smallestUnit(charge.fee, "fee", charge.tx_hash);
  return {
    date,
    mandateId: charge.mandate_id,
    merchant: mandate.merchant,
    amount: exactAmount(amount, meta.decimals),
    fee: exactAmount(fee, meta.decimals),
    net: exactAmount(amount - fee, meta.decimals),
    token: meta.symbol,
    tokenContract,
    txHash: charge.tx_hash,
    ledger: charge.ledger,
  };
}

/**
 * Newest first by date, then by ledger.
 *
 * A missing date sorts last: a row we could not date should not masquerade as
 * the first entry in the file. Ledger breaks ties within a day and orders the
 * undated rows among themselves. The input array is not mutated.
 */
export function sortPaymentsNewestFirst(rows: PaymentRow[]): PaymentRow[] {
  return [...rows].sort((a, b) => {
    const aDated = a.date !== "—";
    const bDated = b.date !== "—";
    if (aDated !== bDated) return aDated ? -1 : 1;
    if (aDated && bDated && a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.ledger - a.ledger;
  });
}

/** `YYYY-MM-DD` — the only date shape the export filename may contain. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date range in an export's filename.
 *
 * `today` is injectable so the fallback is testable. When no row could be
 * dated — a fresh account, or RPC declined every `getTransaction` — the file
 * is named for the day it was produced rather than for the string "all": the
 * acceptance criteria require a date, and "the day of the export" is true.
 */
export function paymentDateRange(
  rows: PaymentRow[],
  today: Date = new Date(),
): { from: string; to: string } {
  const dates = rows
    .map((row) => row.date)
    .filter((date) => ISO_DATE.test(date))
    .sort();
  if (dates.length === 0) {
    const iso = today.toISOString().slice(0, 10);
    return { from: iso, to: iso };
  }
  return { from: dates[0]!, to: dates[dates.length - 1]! };
}

/**
 * The UTC date of a transaction's close time.
 *
 * `rpc.Server.getTransaction` reports `createdAt` in seconds on current
 * versions and milliseconds on some older ones, and RPC serialises the u64 as
 * a decimal string, so both shapes and both units are accepted. An unreadable
 * value becomes "—" rather than "today": a guessed date in a tax record is
 * worse than a visibly missing one, and the ledger column still identifies the
 * charge.
 */
export function createdAtDate(createdAt: unknown): string {
  const value =
    typeof createdAt === "number"
      ? createdAt
      : typeof createdAt === "string"
        ? Number(createdAt)
        : 0;
  if (!Number.isFinite(value) || value <= 0) return "—";
  const ms = value > 1e12 ? value : value * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
