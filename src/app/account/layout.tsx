import type { Metadata } from "next";
import { PAGES, pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata(PAGES.account);

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
