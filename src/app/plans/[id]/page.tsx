import { PLAN_OG_COUNT } from "@/lib/metadata";
import { PlanPageClient } from "./PlanPageClient";

export async function generateStaticParams() {
  return Array.from({ length: PLAN_OG_COUNT }, (_, i) => ({
    id: String(i + 1),
  }));
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlanPageClient planId={id} />;
}
