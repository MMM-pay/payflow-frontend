/**
 * Payflow App Shell Service Worker
 *
 * Caches static assets for the app shell in static export mode.
 * CRITICAL: Under no circumstances does this cache Soroban RPC or indexer API responses.
 */

const CACHE_NAME = "payflow-app-shell-v1";

/**
 * Checks whether a request belongs to the static app shell.
 * RPC and API endpoints are strictly rejected from the cache.
 */
function isShellAsset(request) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);

  // Cross-origin requests (e.g. RPC servers, Horizon, third-party APIs) are never cached.
  if (url.origin !== self.location.origin) return false;

  const path = url.pathname.toLowerCase();

  // Explicitly deny RPC, Horizon, and Backend API routes
  if (
    path.includes("/rpc") ||
    path.includes("/soroban") ||
    path.includes("/horizon") ||
    path.includes("/api") ||
    url.searchParams.has("account") ||
    url.searchParams.has("address")
  ) {
    return false;
  }

  // Cache static assets and HTML pages
  return (
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".png") ||
    path.endsWith(".svg") ||
    path.endsWith(".ico") ||
    path.endsWith(".webmanifest") ||
    path.endsWith(".woff2") ||
    path.endsWith(".woff") ||
    path.endsWith(".html") ||
    path.endsWith("/") ||
    !path.includes(".") // clean Next.js export routes like /merchant/ or /account/
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never intercept or cache non-shell requests (RPC, Horizon, API, non-GET)
  if (!isShellAsset(request)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Fetch in background to update cache (stale-while-revalidate for static assets)
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    }),
  );
});
