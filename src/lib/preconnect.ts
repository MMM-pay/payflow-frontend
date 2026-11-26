/**
 * Origins worth a `preconnect` hint.
 *
 * The first Soroban RPC read and the first indexer fetch otherwise pay for DNS,
 * TCP and TLS in series with the page render. `<link rel="preconnect">` opens
 * those connections while the HTML is still parsing, so the first request only
 * waits for its own round trip.
 *
 * Both are cross-origin CORS fetches, so the hint must be `crossorigin` too: a
 * plain preconnect warms a socket the CORS request cannot reuse, and the hint
 * costs a connection for nothing.
 *
 * Only non-empty absolute http(s) URLs become hints. An empty build-time
 * variable — contract-only mode, which is how the public demo ships — must not
 * produce a link to nothing, and a relative or non-web value would be a
 * configuration bug rather than a hint.
 */
export function preconnectOrigins(
  urls: readonly (string | null | undefined)[],
): string[] {
  const origins: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    const value = raw?.trim();
    if (!value) continue;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") continue;

    // `origin` normalises the host, strips any path and keeps a non-default
    // port, which is exactly the key a connection pool is warmed under.
    const origin = url.origin;
    if (seen.has(origin)) continue;

    seen.add(origin);
    origins.push(origin);
  }

  return origins;
}
