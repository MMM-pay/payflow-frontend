import { StrKey } from "@stellar/stellar-sdk";
import { config } from "./config";
import { DECIMALS, toStroops } from "./format";

/**
 * The connected account's native balance, and whether it exists on the network.
 *
 * A brand new testnet account has no ledger entry at all, so every action
 * fails with "account not found". Knowing that up front lets the app offer to
 * fund it rather than letting the user hit an opaque error on their first
 * click.
 *
 * This reads Horizon, not Soroban RPC: the RPC's `getAccount` returns only the
 * sequence number, with neither a balance nor an entry count, and the RPC
 * exposes no entry count at all. Horizon answers both in one call.
 */

/** The native balance and entry count of an account, as Horizon reports them. */
export interface NativeAccount {
  /** Native balance in stroops. */
  balance: bigint;
  /**
   * Ledger entries the account holds beyond itself — trustlines, offers,
   * data entries, contract entries. Each one raises the minimum balance.
   */
  subentryCount: number;
}

/**
 * `missing` and `unavailable` are kept apart on purpose: an account that does
 * not exist needs funding, whereas an unreachable Horizon means the account
 * may well be fine and must not be sent to the faucet.
 */
export type NativeAccountResult =
  | { state: "found"; account: NativeAccount }
  | { state: "missing" }
  | { state: "unavailable"; message: string };

interface HorizonAccount {
  balances?: Array<{ balance?: string; asset_type?: string }>;
  subentry_count?: number;
}

/** Only a G… account can be funded or read; anything else is a bad wallet. */
function isStellarAccount(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

/** Horizon 404 has a stable type; anything else must not read as "missing". */
function isNotFound(res: Response): boolean {
  return res.status === 404;
}

function parse(body: HorizonAccount): NativeAccount {
  const native = body.balances?.find((b) => b.asset_type === "native" || b.asset_type === undefined);
  const raw = native?.balance ?? "0";
  let balance = 0n;
  try {
    // Horizon sends a decimal string. Parsing it through `toStroops` keeps the
    // conversion in integers: going via Number would lose precision on any
    // balance above ~90 million XLM.
    balance = toStroops(raw, DECIMALS);
  } catch {
    balance = 0n;
  }
  return { balance, subentryCount: Number(body.subentry_count ?? 0) };
}

export async function readNativeAccount(address: string): Promise<NativeAccountResult> {
  if (!address || !isStellarAccount(address)) {
    return { state: "unavailable", message: "That wallet returned an address Stellar does not recognise." };
  }

  let res: Response;
  try {
    res = await fetch(`${config.horizonUrl}/accounts/${address}`, { cache: "no-store" });
  } catch (err) {
    return {
      state: "unavailable",
      message: `Could not reach Horizon: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (isNotFound(res)) return { state: "missing" };
  if (!res.ok) {
    return { state: "unavailable", message: `Horizon returned ${res.status}.` };
  }

  try {
    return { state: "found", account: parse((await res.json()) as HorizonAccount) };
  } catch (err) {
    return {
      state: "unavailable",
      message: `Horizon sent something unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Asks Friendbot to create and fund the account.
 *
 * Testnet only — `config.friendbotUrl` is null off testnet, so this refuses
 * rather than posting an address to a service that does not exist.
 */
export async function fundWithFriendbot(address: string): Promise<void> {
  const base = config.friendbotUrl;
  if (!base) {
    throw new Error("Friendbot is only available on testnet.");
  }
  if (!isStellarAccount(address)) {
    throw new Error("That wallet returned an address Stellar does not recognise.");
  }

  const res = await fetch(`${base}/?addr=${encodeURIComponent(address)}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Friendbot could not fund this account (it replied ${res.status}).`);
  }
}