import { api, type ApiCharge, type ApiMandate } from "@/lib/api";
import { mandateToApi } from "@/lib/chain";
import { config } from "@/lib/config";
import { feeSplit, type TokenMeta } from "@/lib/format";
// The SDK-backed module loads on demand: a receipt is read after the page
// has already painted, so the SDK need not ship with it.
import { payflow, server } from "@/lib/lazy-payflow";
import { loadTokenMeta } from "@/lib/token";

export interface ParsedReceiptParams {
  txHash: string | null;
  mandateId: number | null;
  error: string | null;
}

/**
 * Validate query parameters for the receipt route.
 * Accepts tx (transaction hash) and mandate (mandate ID).
 */
export function parseReceiptParams(params: {
  tx?: string | null;
  mandate?: string | null;
}): ParsedReceiptParams {
  const tx = params.tx?.trim() || null;
  const mandateRaw = params.mandate?.trim() || null;

  if (!tx && !mandateRaw) {
    return {
      txHash: null,
      mandateId: null,
      error: "Missing transaction hash (?tx=…) and mandate ID (?mandate=…).",
    };
  }
  if (!tx) {
    return {
      txHash: null,
      mandateId: null,
      error: "Missing transaction hash (?tx=…).",
    };
  }
  if (!mandateRaw) {
    return {
      txHash: tx,
      mandateId: null,
      error: "Missing mandate ID (?mandate=…).",
    };
  }

  const mandateId = Number(mandateRaw);
  if (!Number.isInteger(mandateId) || mandateId < 0) {
    return {
      txHash: tx,
      mandateId: null,
      error: "Invalid mandate ID: must be a non-negative integer.",
    };
  }

  return {
    txHash: tx,
    mandateId,
    error: null,
  };
}

export function receiptShareUrl(
  currentUrl: string,
  receipt: Pick<ReceiptData, "txHash" | "mandateId">,
): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("tx", receipt.txHash);
  url.searchParams.set("mandate", String(receipt.mandateId));
  return url.toString();
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format a timestamp (in milliseconds) into a clear UTC date/time string.
 */
export function formatReceiptDate(timestampMs: number | null): string {
  if (timestampMs === null || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "—";
  }
  const date = new Date(timestampMs);
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

export interface ReceiptData {
  txHash: string;
  mandateId: number;
  date: string;
  timestamp: number | null;
  subscriber: string;
  merchant: string;
  gross: bigint;
  fee: bigint;
  net: bigint;
  tokenMeta: TokenMeta;
  chargeNumber: number | null;
  totalCharges: number | null;
  ledger: number | null;
  period: number;
  planId: number;
  source: "api" | "contract-estimate";
}

/**
 * Pure builder creating a ReceiptData record from charge, mandate, and token metadata.
 * Ensures amounts stay bigint in their smallest unit (stroops).
 */
export function buildReceiptData(
  charge: ApiCharge | null,
  mandate: ApiMandate,
  tokenMeta: TokenMeta,
  txTimestamp: number | null,
  txHash: string,
): ReceiptData {
  let gross: bigint;
  let fee: bigint;
  let net: bigint;
  let chargeNumber: number | null = null;
  let ledger: number | null = null;
  let source: "api" | "contract-estimate" = "contract-estimate";

  if (charge) {
    gross = BigInt(charge.amount);
    fee = BigInt(charge.fee);
    net = gross - fee;
    chargeNumber = charge.charges_made;
    ledger = charge.ledger;
    source = "api";
  } else {
    gross = BigInt(mandate.amount);
    const split = feeSplit(gross, mandate.fee_bps);
    fee = split.fee;
    net = split.net;
    chargeNumber = mandate.charges_made || null;
    source = "contract-estimate";
  }

  const totalCharges = mandate.max_charges > 0 ? mandate.max_charges : null;

  return {
    txHash,
    mandateId: mandate.id,
    date: formatReceiptDate(txTimestamp),
    timestamp: txTimestamp,
    subscriber: mandate.subscriber,
    merchant: mandate.merchant,
    gross,
    fee,
    net,
    tokenMeta,
    chargeNumber,
    totalCharges,
    ledger,
    period: mandate.period,
    planId: mandate.plan_id,
    source,
  };
}

/**
 * Load complete receipt data for a given mandate ID and transaction hash.
 *
 * Attempts to read charge record from the indexer API. If the API is offline
 * or in contract-only mode, falls back to reading the mandate from contract
 * state simulation and returns apiAvailable: false so the UI can explain
 * the limitation clearly.
 */
export async function loadReceipt(
  mandateId: number,
  txHash: string,
): Promise<{
  receipt: ReceiptData | null;
  apiAvailable: boolean;
  error: string | null;
}> {
  let charge: ApiCharge | null = null;
  let apiAvailable = false;

  // 1. Query indexer for charge
  try {
    const chargesRes = await api.charges(mandateId);
    if (chargesRes !== null) {
      apiAvailable = true;
      charge =
        chargesRes.charges.find(
          (c) => c.tx_hash.toLowerCase() === txHash.toLowerCase(),
        ) ?? null;
    }
  } catch {
    apiAvailable = false;
  }

  // 2. Query mandate from contract (or API)
  let mandate: ApiMandate | null = null;
  try {
    const raw = await payflow.getMandate(config.readSource, mandateId);
    if (raw) {
      mandate = mandateToApi(raw);
    }
  } catch {
    // Contract simulation failed; try API mandate
    try {
      mandate = await api.mandate(mandateId);
    } catch {
      mandate = null;
    }
  }

  if (!mandate) {
    return {
      receipt: null,
      apiAvailable,
      error: `Mandate #${mandateId} could not be found on-chain or in API index.`,
    };
  }

  // 3. Resolve token metadata (symbol and decimals)
  const tokenContract = mandate.token || config.contracts.token;
  const tokenMeta = await loadTokenMeta(tokenContract);

  // 4. Resolve transaction timestamp from RPC
  let timestamp: number | null = null;
  try {
    const tx = await server.getTransaction(txHash);
    if ("createdAt" in tx && typeof tx.createdAt === "number") {
      const createdAt = tx.createdAt;
      timestamp = createdAt > 1e12 ? createdAt : createdAt * 1000;
    }
  } catch {
    // Best effort RPC lookup
  }

  const receipt = buildReceiptData(charge, mandate, tokenMeta, timestamp, txHash);
  return {
    receipt,
    apiAvailable,
    error: null,
  };
}

/** The filename a downloaded receipt is saved under. */
export function receiptFilename(
  receipt: Pick<ReceiptData, "mandateId" | "txHash">,
): string {
  return `payflow-receipt-${receipt.mandateId}-${receipt.txHash.slice(0, 8)}.html`;
}

/**
 * Download one receipt as a standalone HTML file in the browser.
 *
 * The HTML template is imported on demand: the receipt route only pays for it
 * when the user actually downloads, not on first paint.
 */
export function buildReceiptHtml(receipt: ReceiptData): string {
  const decimals = receipt.tokenMeta.decimals;
  const amount = (value: bigint) => `${fromStroops(value, decimals, decimals)} ${receipt.tokenMeta.symbol}`;
  const gross = amount(receipt.gross);
  const fee = amount(receipt.fee);
  const net = amount(receipt.net);
  const esc = escapeReceiptHtml;
  const explorer = `${explorerBase}/tx/${receipt.txHash}`;
  const charge =
    receipt.chargeNumber === null
      ? "Recurring charge"
      : receipt.totalCharges
        ? `Charge ${receipt.chargeNumber} of ${receipt.totalCharges}`
        : `Charge #${receipt.chargeNumber}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payflow receipt — mandate ${receipt.mandateId}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px; background: #f5f7fa; color: #0f172a; font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #d3dce7; border-radius: 12px; padding: 32px; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; border-bottom: 1px solid #d3dce7; padding-bottom: 20px; }
  h1 { margin: 4px 0 0; font-size: 22px; }
  .brand { font-weight: 700; font-size: 18px; }
  .brand span { color: #067647; }
  .muted { color: #52606f; font-size: 13px; }
  .status { align-self: flex-start; border-radius: 999px; background: #e8f5ef; color: #067647; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; margin: 24px 0; }
  dt { color: #52606f; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  dd { margin: 2px 0 0; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: start; padding: 10px 0; border-bottom: 1px solid #e6ebf1; }
  th:last-child, td:last-child { text-align: end; font-variant-numeric: tabular-nums; }
  tfoot th, tfoot td { border-bottom: 0; border-top: 2px solid #d3dce7; font-weight: 700; font-size: 16px; }
  footer { border-top: 1px solid #d3dce7; margin-top: 24px; padding-top: 16px; font-size: 12px; color: #52606f; overflow-wrap: anywhere; }
  a { color: #067647; }
  @media print { body { background: #fff; padding: 0; } main { border: 0; padding: 0; } }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <div class="brand">Pay<span>flow</span> <span class="muted">Receipt</span></div>
      <h1>Payment receipt</h1>
      <p class="muted">Mandate #${receipt.mandateId} · Plan #${receipt.planId}</p>
    </div>
    <div>
      <span class="status">Settled</span>
      <p class="muted">${esc(receipt.date)}</p>
    </div>
  </header>
  <dl>
    <div><dt>Subscriber (payer)</dt><dd>${esc(receipt.subscriber)}</dd></div>
    <div><dt>Merchant (payee)</dt><dd>${esc(receipt.merchant)}</dd></div>
    <div><dt>Billing frequency</dt><dd>${esc(formatPeriod(receipt.period))}</dd></div>
    <div><dt>Charge sequence</dt><dd>${esc(charge)}${receipt.ledger === null ? "" : ` · Ledger #${receipt.ledger}`}</dd></div>
  </dl>
  <table>
    <thead><tr><th scope="col">Description</th><th scope="col">Amount</th></tr></thead>
    <tbody>
      <tr><td>Subscription charge (mandate #${receipt.mandateId})</td><td>${esc(gross)}</td></tr>
      <tr><td>Protocol fee</td><td>-${esc(fee)}</td></tr>
      <tr><td>Net payout to merchant</td><td>${esc(net)}</td></tr>
    </tbody>
    <tfoot><tr><th scope="row">Total paid</th><td>${esc(gross)}</td></tr></tfoot>
  </table>
  <footer>
    <p><strong>Transaction:</strong> ${esc(receipt.txHash)}</p>
    <p><a href="${esc(explorer)}" rel="noreferrer">${esc(explorer)}</a></p>
    <p>Settled permissionlessly on Stellar via a Payflow recurring mandate. Funds were debited directly from the subscriber's vault. This file was generated by the Payflow app and can be printed or kept for your records.</p>
  </footer>
</main>
</body>
</html>
`;
}

/** Download one receipt as a standalone HTML file in the browser. */
export function downloadReceipt(receipt: ReceiptData): void {
export async function downloadReceipt(receipt: ReceiptData): Promise<void> {
  const { buildReceiptHtml } = await import("./receipt-html");
  const blob = new Blob([buildReceiptHtml(receipt)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = receiptFilename(receipt);
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
