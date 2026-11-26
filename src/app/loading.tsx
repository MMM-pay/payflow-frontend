"use client";

import { SkeletonRows } from "@/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <SkeletonRows rows={4} label="Loading" />
    </div>
  );
}
