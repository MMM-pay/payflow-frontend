import type { Metadata } from "next";
import { PAGES, pageMetadata } from "@/lib/metadata";

/**
 * The canonical link has to name the plan, not the route: a crawler that
 * resolved `/plans/` would land on a 404, and every plan would claim the same
 * address. The id is a build-time parameter here, so it is known.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return pageMetadata(PAGES.plan, { path: `/plans/${id}/` });
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
