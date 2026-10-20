import { shortAddress } from "./format";

/** A single charge row for the merchant revenue export. */
export interface ChargeRow {
  /** ISO date (or "—" when unavailable in contract-only mode). */
  date: string;
  /** On-chain mandate id. */
  mandateId: number;
  /** Subscriber Stellar address. */
  subscriber: string;
  /** Gross amount, decimal string in XLM (never a float). */
  gross: string;
  /** Protocol fee, decimal string in XLM. */
  fee: string;
  /** Net amount (gross - fee), decimal string in XLM. */
  net: string;
  /** Transaction hash. */
  txHash: string;
}

const HEADER = ["date", "mandate id", "subscriber", "gross", "fee", "net", "tx hash"];

/**
 * A single payment row for the subscriber's own expense export.
 *
 * Deliberately separate from `ChargeRow`: a subscriber's file must not carry
 * another subscriber's address, and it needs the token each row is denominated
 * in because a wallet can pay mandates in more than one token.
 */
export interface PaymentRow {
  /** ISO date (or "—" when the transaction's close time could not be read). */
  date: string;
  /** On-chain mandate id. */
  mandateId: number;
  /** Merchant Stellar address. */
  merchant: string;
  /** Gross amount debited from the subscriber, decimal string. */
  amount: string;
  /** Protocol fee included in the gross amount, decimal string. */
  fee: string;
  /** What the merchant received, decimal string. */
  net: string;
  /** Symbol read from the token contract, e.g. "USDC". */
  token: string;
  /** Token contract id, so rows stay unambiguous if two tokens share a symbol. */
  tokenContract: string;
  /** Transaction hash. */
  txHash: string;
  /** Ledger the charge was settled in; the one ordering key the indexer serves. */
  ledger: number;
}

const PAYMENT_HEADER = [
  "date",
  "mandate id",
  "merchant",
  "amount",
  "fee",
  "net",
  "token",
  "token contract",
  "tx hash",
  "ledger",
];

/** Escape a CSV field per RFC 4180 (quotes, commas, newlines). */
function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize charge rows to CSV. Amounts are decimal strings, never floats. */
export function buildCsv(rows: ChargeRow[]): string {
  const lines = [HEADER.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.mandateId,
        row.subscriber,
        row.gross,
        row.fee,
        row.net,
        row.txHash,
      ].map(escapeCsv).join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Serialize subscriber payment rows to CSV.
 *
 * The same RFC 4180 escaping as the merchant export applies: these files are
 * opened in spreadsheets, and an address or token symbol containing a comma
 * must not shift every later column by one.
 */
export function buildPaymentsCsv(rows: PaymentRow[]): string {
  const lines = [PAYMENT_HEADER.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.mandateId,
        row.merchant,
        row.amount,
        row.fee,
        row.net,
        row.token,
        row.tokenContract,
        row.txHash,
        row.ledger,
      ].map(escapeCsv).join(","),
    );
  }
  return lines.join("\n");
}

/** Filename includes the merchant address and the date range of the export. */
export function exportFilename(
  address: string,
  from: string,
  to: string,
): string {
  return `payflow-${shortAddress(address)}-${from}_to_${to}.csv`;
}

/**
 * Filename for a subscriber's payment export.
 *
 * Carries the full address rather than the shortened form used by the merchant
 * export: the file is handed to an accountant, and two accounts that happen to
 * share their first and last four characters must not produce the same file
 * name. `from` and `to` are always concrete dates (see `paymentDateRange`).
 */
export function paymentsFilename(
  address: string,
  from: string,
  to: string,
): string {
  return `payflow-payments-${address}-${from}_to_${to}.csv`;
}

/** Download CSV text as a file in the browser. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
