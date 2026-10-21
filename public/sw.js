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

// ---------------------------------------------------------------------------
// Charge reminders (issue #174)
// ---------------------------------------------------------------------------

/**
 * The account page computes the reminder schedule from mandate state and sends
 * it here after an explicit "Remind me" click. Where the browser implements
 * Notification Triggers, `showTrigger` lets the OS wake the installed app at
 * the requested time. Otherwise the page keeps the timers while it is open,
 * and this worker is only the delivery channel — there is no background timer
 * that could survive the worker being stopped.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "payflow-reminders-sync") return;

  const reminders = Array.isArray(data.reminders) ? data.reminders : [];
  const activeTags = new Set(
    reminders.map((reminder) => reminder && reminder.tag).filter(Boolean),
  );

  // Drop any Payflow notification whose mandate is no longer in the active
  // set. This is what makes opt-out and a ended mandate visible immediately,
  // rather than waiting for the old trigger to fire.
  const cleanup =
    typeof self.registration.getNotifications === "function"
      ? self.registration.getNotifications().then((notifications) => {
          for (const notification of notifications) {
            if (
              notification.tag &&
              notification.tag.startsWith("payflow-mandate-") &&
              !activeTags.has(notification.tag)
            ) {
              notification.close();
            }
          }
        })
      : Promise.resolve();

  // Notification Triggers are the only API that survives the page and worker
  // being suspended. Feature-detect rather than assume: on unsupported
  // browsers the page's timers are the whole mechanism.
  if (typeof self.TimestampTrigger !== "function") {
    event.waitUntil(cleanup);
    return;
  }

  const scheduled = [];
  for (const reminder of reminders) {
    if (!reminder || typeof reminder.at !== "number" || typeof reminder.tag !== "string") {
      continue;
    }
    if (reminder.at <= Date.now()) {
      // Already due: the page timer shows it immediately without duplicating.
      continue;
    }
    try {
      scheduled.push(
        self.registration
          .showNotification(reminder.title, {
            body: reminder.body,
            tag: reminder.tag,
            icon: `${self.registration.scope}icon-192.png`,
            data: { url: `${self.registration.scope}account/` },
            showTrigger: new self.TimestampTrigger(reminder.at),
          })
          .catch(() => {}),
      );
    } catch {
      // The page's fallback timer still covers this reminder.
    }
  }
  event.waitUntil(Promise.all([cleanup, ...scheduled]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) ||
    `${self.registration.scope}account/`;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.startsWith(self.registration.scope)) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
