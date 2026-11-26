import { explorerBase } from "./config";
import { formatPeriod, fromStroops } from "./format";
import type { ReceiptData } from "./receipt";

/**
 * The standalone HTML receipt, kept in its own module so the receipt route
 * ships only the code that renders the on-screen receipt. The download is an
 * explicit click, so its markup and inline styles are fetched then.
 */

/** Escape text before it is placed in the downloaded HTML receipt. */
export function escapeReceiptHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A standalone HTML receipt, with every figure printed in the token's own
 * smallest-unit scale (not the 4-digit display rounding used on screen).
 *
 * Built as a string rather than fetched: payment history comes from the
 * indexer and the download must keep working offline once the row is on
 * screen. Values are escaped, and the file has no scripts or external assets,
 * so it can be kept or printed as-is.
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
  th, td { text-align: left; padding: 10px 0; border-bottom: 1px solid #e6ebf1; }
  th:last-child, td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
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
