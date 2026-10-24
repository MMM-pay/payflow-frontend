"use client";

import { useEffect, useState } from "react";
import {
  activeNetwork,
  availableNetworks,
  defaultNetwork,
  selectNetwork,
  type NetworkConfig,
} from "./config";

export interface NetworkChoice {
  /**
   * The network in force. Like the theme toggle, the first render shows the
   * build default — the value the static export was prerendered with — and
   * the stored choice is adopted after mount, so hydration never sees markup
   * the prerender did not produce.
   */
  network: NetworkConfig;
  /** Networks the switcher may offer; incomplete ones are hidden. */
  networks: NetworkConfig[];
  /** Persist the choice and reload onto that network. */
  select: (id: string) => void;
}

export function useNetwork(): NetworkChoice {
  const [network, setNetwork] = useState<NetworkConfig>(defaultNetwork);

  useEffect(() => {
    setNetwork(activeNetwork());
  }, []);

  return { network, networks: availableNetworks(), select: selectNetwork };
}
