import type { Metadata } from "next";
import { PAGES, pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata(PAGES.merchant);

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
