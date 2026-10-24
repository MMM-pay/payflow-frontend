import { config } from "@/lib/config";
import { PlanPageClient } from "./PlanPageClient";

export async function generateStaticParams() {
  // Pre-render at least one plan route so the dynamic segment is statically
  // exported. The contract cannot be called reliably at build time because the
  // read source account may not be configured; fall back to a single route.
  try {
    const { payflow } = await import("@/lib/payflow");
    const next = Number(await payflow.nextPlanId(config.readSource));
    const newest = Math.min(24, Math.max(0, next - 1));
    const ids = Array.from({ length: newest }, (_, i) => next - 1 - i);
    return ids.map((id) => ({ id: String(id) }));
  } catch {
    return [{ id: "1" }];
  }
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PlanPageClient planId={id} />;
}
