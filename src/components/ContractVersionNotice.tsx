"use client";

import { useSyncExternalStore } from "react";
import {
  contractDriftMessage,
  getContractDrift,
  subscribeContractDrift,
  type ContractDrift,
} from "@/lib/contract-compat";
import { Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

/**
 * Says, once, that the deployed contracts are ahead of this build.
 *
 * The pages keep working: unknown fields are ignored and an unknown status is
 * shown verbatim rather than treated as active. The notice is the only thing
 * added, so a newer deployment never turns into a blank page or a crash.
 *
 * `drift` lets a page or test pass what it already knows; without it the
 * component follows the reads other components have observed.
 */
export function ContractVersionNotice({ drift }: { drift?: ContractDrift }) {
  const { t: tr } = useI18n();
  const observed = useSyncExternalStore(
    subscribeContractDrift,
    getContractDrift,
    getContractDrift,
  );
  const value = drift ?? observed;
  if (!value.newer) return null;
  return <Notice tone="info">{tr(contractDriftMessage(value))}</Notice>;
}
