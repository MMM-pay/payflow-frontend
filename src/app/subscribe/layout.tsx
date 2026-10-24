import type { Metadata } from "next";
import { PAGES, pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata(PAGES.subscribe);

export default function SubscribeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
