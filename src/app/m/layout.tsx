import type { Metadata } from "next";
import { PAGES, pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata(PAGES.catalogue);

export default function MerchantPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
