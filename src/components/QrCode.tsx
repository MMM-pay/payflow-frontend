"use client";

import { useMemo } from "react";
import { qrMatrix, qrPath } from "@/lib/qr";

/**
 * A QR code, drawn as SVG.
 *
 * The code is described to a screen reader rather than left silent: a phone
 * camera reads it, a screen reader cannot, so the link next to the code is
 * the accessible way to reach the same place.
 */
export function QrCode({
  data,
  size = 168,
  label,
}: {
  data: string;
  /** Rendered size in CSS pixels. */
  size?: number;
  /** What the code leads to, e.g. "the link to the Pro Monthly plan". */
  label: string;
}) {
  const modules = useMemo(() => qrMatrix(data), [data]);
  const path = useMemo(() => qrPath(modules), [modules]);
  // The quiet zone: scanners need a light margin around the code to find it.
  const margin = 2;
  const count = modules.length;
  const extent = count + margin * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label={label}
      className="rounded-lg bg-white p-2"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path
        d={path}
        fill="#000000"
        shapeRendering="crispEdges"
        transform={`translate(${margin} ${margin})`}
      />
    </svg>
  );
}
