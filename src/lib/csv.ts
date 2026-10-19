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

/** Filename includes the merchant address and the date range of the export. */
export function exportFilename(
  address: string,
  from: string,
  to: string,
): string {
  return `payflow-${shortAddress(address)}-${from}_to_${to}.csv`;
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
