/**
 * A merchant's self-declared profile: the display name and URL subscribers see
 * beside the plans they are about to pay for.
 *
 * The limits are the contract's own (`MAX_NAME_LEN` and `MAX_URL_LEN` in
 * payflow-contract's plan registry), checked here in bytes rather than
 * characters so a name the chain would reject never reaches the wallet.
 */

/** Longest display name the registry accepts, in bytes. */
export const MAX_PROFILE_NAME_LEN = 64;

/** Longest profile URL the registry accepts, in bytes. */
export const MAX_PROFILE_URL_LEN = 256;

export interface MerchantProfile {
  name: string;
  url: string;
}

/** A merchant with no profile, and the starting point of the form. */
export const emptyProfile: MerchantProfile = { name: "", url: "" };

/**
 * A check carries the trimmed value on success, so a caller submits exactly
 * what was validated rather than re-trimming and diverging from it.
 */
export type NameCheck = { ok: true; name: string } | { ok: false; message: string };
export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Whether a profile read came back from a contract that carries profiles at
 * all. A contract without the getter answers null, which is not the same as a
 * merchant who has set no profile.
 */
export function profileSupports(result: MerchantProfile | null): boolean {
  return result !== null;
}

/**
 * Whether this name can be submitted. An empty name is allowed: it is how a
 * merchant clears a profile they no longer want shown.
 */
export function checkProfileName(name: string): NameCheck {
  const trimmed = name.trim();
  if (byteLength(trimmed) > MAX_PROFILE_NAME_LEN) {
    return {
      ok: false,
      message: `That name is too long — ${MAX_PROFILE_NAME_LEN} bytes maximum.`,
    };
  }
  return { ok: true, name: trimmed };
}

/**
 * Whether this URL can be submitted. Only `http(s)` is accepted: the URL is
 * shown to subscribers as a link, and any other scheme is a way to point them
 * somewhere a browser should not follow from a payment page.
 */
export function checkProfileUrl(url: string): UrlCheck {
  const trimmed = url.trim();
  if (trimmed === "") return { ok: true, url: "" };
  if (byteLength(trimmed) > MAX_PROFILE_URL_LEN) {
    return {
      ok: false,
      message: `That URL is too long — ${MAX_PROFILE_URL_LEN} bytes maximum.`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: "Enter a full URL, including https://." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, message: "Only http and https links can be shown to subscribers." };
  }
  return { ok: true, url: trimmed };
}
