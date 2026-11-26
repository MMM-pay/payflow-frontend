"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { qrMatrix, qrPath } from "@/lib/qr";
import { useReducedData } from "@/lib/useReducedData";

/**
 * A QR code, drawn as SVG.
 *
 * The code is described to a screen reader rather than left silent: a phone
 * camera reads it, a screen reader cannot, so the link next to the code is
 * the accessible way to reach the same place. When reduced-data is active,
 * generation and rendering wait for an explicit keyboard/button activation.
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
  const { t: tr } = useI18n();
  const reducedData = useReducedData();
  const [forceLoad, setForceLoad] = useState(false);
  const deferred = reducedData && !forceLoad;

  const modules = useMemo(() => (deferred ? null : qrMatrix(data)), [data, deferred]);
  const path = useMemo(() => (modules ? qrPath(modules) : ""), [modules]);

  if (deferred || !modules) {
    return (
      <div
        role="region"
        aria-label={label}
        className="flex flex-col items-start gap-2 rounded-lg border border-edge bg-panel p-3 text-xs text-muted"
      >
        <p>{tr("QR code skipped to save data.")}</p>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => setForceLoad(true)}
          aria-label={tr("Load QR code for {0}", { "0": label })}
        >
          {tr("Load QR code")}
        </button>
      </div>
    );
  }

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
