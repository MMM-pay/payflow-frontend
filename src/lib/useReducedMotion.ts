import { useEffect, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` setting so animated UI (e.g.
 * charts) can disable motion. Returns `false` during SSR and the initial
 * client render, then updates once the media query can be read, and stays in
 * sync if the OS-level preference changes.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
