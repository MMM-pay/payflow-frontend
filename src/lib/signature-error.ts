/** Shown when the user declines the wallet prompt. Nothing was submitted. */
export const SIGNATURE_CANCELLED_MESSAGE =
  "You cancelled the signature. Nothing was sent.";

/**
 * SEP-43 code for "the user rejected the request". Freighter returns it on
 * `Error.code`; Albedo rejects with the same code on a plain object
 * (`actionRejectedByUser`). The message text is wallet-defined.
 */
const USER_REJECTED_CODE = -4;

/**
 * Phrases wallets throw when they do not set the SEP-43 code. Kept narrow so
 * a network result such as "deposit rejected: ..." is not treated as a cancel.
 */
const USER_REJECTED_TEXT =
  /user (?:rejected|declined|denied|cancelled|canceled)\b|rejected by the user|declined by the user/i;

function signatureErrorSignals(
  error: unknown,
  depth = 0,
): { texts: string[]; rejectedCode: boolean } {
  if (depth > 3 || error == null) return { texts: [], rejectedCode: false };
  if (typeof error === "string") return { texts: [error], rejectedCode: false };
  if (typeof error !== "object") return { texts: [], rejectedCode: false };

  const record = error as { message?: unknown; code?: unknown; error?: unknown };
  const texts: string[] = [];
  if (typeof record.message === "string" && record.message) texts.push(record.message);
  if (error instanceof Error && error.message && !texts.includes(error.message)) {
    texts.push(error.message);
  }
  const rejectedCode = record.code === USER_REJECTED_CODE || record.code === "-4";

  if (record.error == null || record.error === error) {
    return { texts, rejectedCode };
  }
  const nested = signatureErrorSignals(record.error, depth + 1);
  return {
    texts: texts.concat(nested.texts),
    rejectedCode: rejectedCode || nested.rejectedCode,
  };
}

/**
 * True when the wallet reports that the user declined signing. Two shapes are
 * recognised: Freighter's `Error` ("The user rejected this request.", often
 * with code -4) and Albedo's plain object ("Action request was rejected by
 * the user.", code -4).
 */
export function isSignatureRejection(error: unknown): boolean {
  const { texts, rejectedCode } = signatureErrorSignals(error);
  if (rejectedCode) return true;
  return texts.some((text) => USER_REJECTED_TEXT.test(text));
}

/** Re-throws `error`, replacing a wallet cancellation with a sentence a user can act on. */
export function translateSignatureError(error: unknown): never {
  if (isSignatureRejection(error)) {
    throw new Error(SIGNATURE_CANCELLED_MESSAGE);
  }
  throw error;
}
