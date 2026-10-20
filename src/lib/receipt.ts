import { api, type ApiCharge, type ApiMandate } from "@/lib/api";
import { mandateToApi } from "@/lib/chain";
import { config } from "@/lib/config";
import { feeSplit, type TokenMeta } from "@/lib/format";
import { payflow, server } from "@/lib/payflow";
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
