import { config } from "./config";
import { getKit } from "./wallet";
import { translateSignatureError } from "./signature-error";

/** Message signing only: never constructs or submits a transaction. */
export async function signWebhookProof(message: string, merchant: string): Promise<string> {
  const kit = await getKit();
  async function checkWallet() {
    const { address } = await kit.getAddress();
    if (address !== merchant) throw new Error("Wallet account changed. Reload history with the connected account.");
    const { networkPassphrase } = await kit.getNetwork();
    if (networkPassphrase !== config.networkPassphrase) throw new Error("Switch your wallet to the correct network first.");
  }
  await checkWallet();
  try {
    const { signedMessage, signerAddress } = await kit.signMessage(message, { address: merchant, networkPassphrase: config.networkPassphrase });
    await checkWallet();
    if (signerAddress && signerAddress !== merchant) throw new Error("The signature belongs to another wallet account.");
    if (!signedMessage) throw new Error("This wallet did not return a message signature. Try a wallet that supports message signing.");
    return signedMessage;
  } catch (error) {
    translateSignatureError(error);
  }
}
