import { useState, useEffect } from "react";
import { Contract, scValToNative, xdr, rpc } from "@stellar/stellar-sdk";
import { config } from "./config";

/**
 * Reflector Oracle Contract IDs:
 * - Testnet: CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63 (Crypto feed)
 * - Mainnet: CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN
 */
export const REFLECTOR_TESTNET_ORACLE =
  "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63";
export const REFLECTOR_MAINNET_ORACLE =
  "CAFJZQWSED6YAWZU3GWRTOCNPPCGBN32L7QV43XX5LZLFTK6JLN34DLN";

/** Cache time-to-live for the fetched oracle price in milliseconds (60 seconds). */
export const PRICE_CACHE_TTL_MS = 60_000;

export interface OraclePrice {
  price: bigint;
  decimals: number;
  timestamp: number;
  fetchedAt: number;
}

let cachedPrice: OraclePrice | null = null;
let inflightFetch: Promise<OraclePrice | null> | null = null;

/**
 * Resolve the Reflector oracle contract address for the active network.
 */
export function getReflectorOracleId(): string {
  if (process.env.NEXT_PUBLIC_REFLECTOR_ORACLE_ID) {
    return process.env.NEXT_PUBLIC_REFLECTOR_ORACLE_ID;
  }
  const net = config.network.toUpperCase();
  if (net === "PUBLIC" || net === "MAINNET") {
    return REFLECTOR_MAINNET_ORACLE;
  }
  return REFLECTOR_TESTNET_ORACLE;
}

/**
 * Clear the in-memory price cache. Exported for tests.
 */
export function clearPriceCache(): void {
  cachedPrice = null;
  inflightFetch = null;
}

/**
 * Read the current XLM/USD price from the Reflector oracle contract on the active network.
 *
 * Caches the response in memory for 60 seconds to avoid repeating RPC calls on every render.
 * Returns null if the oracle contract is unreachable, unconfigured, or errors.
 */
export async function fetchXlmUsdPrice(options?: {
  rpcUrl?: string;
  networkPassphrase?: string;
  oracleId?: string;
  sourceAccount?: string;
}): Promise<OraclePrice | null> {
  const now = Date.now();
  if (cachedPrice && now - cachedPrice.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cachedPrice;
  }

  if (inflightFetch) {
    return inflightFetch;
  }

  inflightFetch = (async () => {
    try {
      const oracleId = options?.oracleId ?? getReflectorOracleId();
      if (!oracleId) return null;

      const rpcUrl = options?.rpcUrl ?? config.rpcUrl;
      const passphrase = options?.networkPassphrase ?? config.networkPassphrase;
      const sourceAccount = options?.sourceAccount ?? config.readSource;

      const server = new rpc.Server(rpcUrl);
      const contract = new Contract(oracleId);

      // 1. Query decimals()
      const decimalsOp = contract.call("decimals");
      const { Account, TransactionBuilder } = await import("@stellar/stellar-sdk");
      const account = new Account(sourceAccount, "0");
      const decimalsTx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: passphrase,
      })
        .addOperation(decimalsOp)
        .setTimeout(30)
        .build();

      const decimalsSim = await server.simulateTransaction(decimalsTx);
      if (!rpc.Api.isSimulationSuccess(decimalsSim) || !decimalsSim.result?.retval) {
        return null;
      }
      const decimals = Number(scValToNative(decimalsSim.result.retval));

      // 2. Query lastprice(Asset::Other("XLM"))
      const assetScVal = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Other"),
        xdr.ScVal.scvSymbol("XLM"),
      ]);
      const lastpriceOp = contract.call("lastprice", assetScVal);
      const lastpriceTx = new TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: passphrase,
      })
        .addOperation(lastpriceOp)
        .setTimeout(30)
        .build();

      const priceSim = await server.simulateTransaction(lastpriceTx);
      if (!rpc.Api.isSimulationSuccess(priceSim) || !priceSim.result?.retval) {
        return null;
      }

      const native = scValToNative(priceSim.result.retval) as
        | { price: bigint; timestamp: bigint | number }
        | null;

      if (!native || typeof native.price !== "bigint") {
        return null;
      }

      const res: OraclePrice = {
        price: native.price,
        decimals,
        timestamp: Number(native.timestamp),
        fetchedAt: Date.now(),
      };
      cachedPrice = res;
      return res;
    } catch {
      // Contract call failed, network down, or oracle unavailable.
      // Gracefully return null per acceptance criteria.
      return null;
    } finally {
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

/**
 * Format a token amount into an estimated USD string using pure bigint arithmetic.
 *
 * Never uses floating point math for currency calculations.
 * Rounds to the nearest cent ($X.XX).
 *
 * @param amountStroops Amount in smallest units (stroops)
 * @param oraclePrice Raw oracle price integer (from Reflector)
 * @param oracleDecimals Decimal scaling of oracle price (e.g. 14)
 * @param tokenDecimals Decimal scaling of token (default 7 for XLM)
 */
export function formatUsdEstimate(
  amountStroops: bigint | string | number,
  oraclePrice: bigint,
  oracleDecimals: number,
  tokenDecimals = 7,
): string {
  const amt = BigInt(amountStroops);
  if (amt <= 0n || oraclePrice <= 0n) {
    return "$0.00";
  }

  // Cents formula:
  // (amt * oraclePrice * 100) / (10^(tokenDecimals + oracleDecimals))
  const totalDecimals = BigInt(tokenDecimals + oracleDecimals);
  const divisor = 10n ** totalDecimals;

  // Half-up rounding to nearest cent:
  const cents = (amt * oraclePrice * 100n + divisor / 2n) / divisor;

  if (cents === 0n) {
    return "< $0.01";
  }

  const dollars = cents / 100n;
  const remCents = cents % 100n;
  return `$${dollars.toString()}.${remCents.toString().padStart(2, "0")}`;
}

/**
 * Format a USD token (such as USDC, 6 decimals) directly to USD string using bigint math.
 */
export function formatUsdcEstimate(
  amountStroops: bigint | string | number,
  tokenDecimals = 6,
): string {
  const amt = BigInt(amountStroops);
  if (amt <= 0n) return "$0.00";

  const divisor = 10n ** BigInt(tokenDecimals);
  const cents = (amt * 100n + divisor / 2n) / divisor;
  if (cents === 0n) return "< $0.01";

  const dollars = cents / 100n;
  const remCents = cents % 100n;
  return `$${dollars.toString()}.${remCents.toString().padStart(2, "0")}`;
}

/**
 * React hook to read the active XLM/USD price from Reflector oracle.
 */
export function useXlmUsdPrice() {
  const [priceData, setPriceData] = useState<OraclePrice | null>(cachedPrice);
  const [loading, setLoading] = useState<boolean>(!cachedPrice);

  useEffect(() => {
    let cancelled = false;
    void fetchXlmUsdPrice().then((res) => {
      if (!cancelled) {
        setPriceData(res);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { priceData, loading };
}

/**
 * React hook to compute the estimated USD value for an amount.
 *
 * Returns null when the oracle is unavailable, token is not supported,
 * or amount is null/empty.
 */
export function useUsdEstimate(
  amountStroops: bigint | string | number | null | undefined,
  tokenSymbol?: string,
  tokenDecimals = 7,
): string | null {
  const { priceData } = useXlmUsdPrice();

  if (amountStroops === null || amountStroops === undefined || amountStroops === "") {
    return null;
  }

  const sym = (tokenSymbol ?? "XLM").toUpperCase();

  // If token is USDC, 1 USDC ≈ $1.00 USD
  if (sym === "USDC") {
    try {
      return formatUsdcEstimate(amountStroops, tokenDecimals);
    } catch {
      return null;
    }
  }

  // For XLM, read from Reflector oracle
  if (sym === "XLM" && priceData) {
    try {
      return formatUsdEstimate(
        amountStroops,
        priceData.price,
        priceData.decimals,
        tokenDecimals,
      );
    } catch {
      return null;
    }
  }

  return null;
}
