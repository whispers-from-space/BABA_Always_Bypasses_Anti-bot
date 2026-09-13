// camofox-client.js
//
// Shared camofox-browser helpers, used by BOTH:
//   - the pi extension  (src/index.ts  -> `import ... from "../lib/camofox-client.js"`)
//   - the skills        (skills/ask-*  -> `require("../../lib/camofox-client")`)
//
// Single source of truth for profile/userId resolution and the REST client, so
// a skill talks to the *same* logged-in camofox-browser session that
// interactive camofox_open uses -- no separate "skill-only" profile or second
// login.
//
// CommonJS (no build step) so the plain .js skills can require() it directly.
// jiti (which loads src/index.ts) provides CJS named-export interop, so the
// TS side can `import { resolveProfileForUrl, ... }` from it too.
//
// Layout: <extension-root>/lib/camofox-client.js  => root is one level up.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const BASE_URL = process.env.CAMOFOX_URL || "http://localhost:9377";
const API_KEY = process.env.CAMOFOX_API_KEY; // optional, only if the server requires auth

const EXTENSION_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(EXTENSION_ROOT, ".camofox");
const PROFILES_PATH = path.join(DATA_DIR, "pi-profiles.json");
const HARNESS_CONFIG_PATH = path.join(
  process.env.HOME ?? "",
  ".pi",
  "agent",
  "camoufox-harness.json"
);

// --- harness config + profile resolution ------------------------------------

/**
 * Read ~/.pi/agent/camoufox-harness.json (the URL -> profile map camofox_open
 * uses). Returns {} if missing/unparseable.
 * @returns {{ defaultProfile?: string, siteToProfile?: Record<string, string> }}
 */
function loadHarnessConfig() {
  try {
    return JSON.parse(fs.readFileSync(HARNESS_CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Resolve the profile for a URL via longest domain-suffix match in
 * siteToProfile, else defaultProfile, else "default". An explicit profile
 * always beats this -- pass it straight to resolveUserId.
 * @param {string} url
 * @returns {string}
 */
function resolveProfileForUrl(url) {
  const { defaultProfile, siteToProfile } = loadHarnessConfig();
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // unparseable URL -> fall through to the defaults
  }
  let bestKey = "";
  for (const key of Object.keys(siteToProfile ?? {})) {
    const k = key.toLowerCase();
    if (!k) continue;
    if ((host === k || host.endsWith(`.${k}`)) && k.length > bestKey.length) {
      bestKey = k;
    }
  }
  if (bestKey) return siteToProfile[bestKey];
  return defaultProfile || "default";
}

// --- profile -> userId map (.camofox/pi-profiles.json) ----------------------
//
// A "profile" is just a stable label -> userId mapping. The userId is
// persisted in .camofox/pi-profiles.json, so the SAME userId is reused across
// pi and the skills -> they share cookies/localStorage. If a profile has no
// entry yet, generate one with pi's exact algorithm so a future camofox_open
// for the same profile adopts it instead of forking a second session.

/** @returns {Record<string, string>} */
function loadProfileMap() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/** @param {Record<string, string>} map */
function saveProfileMap(map) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(map, null, 2));
}

/**
 * Resolve (creating if needed) the persisted userId for a profile.
 * @param {string} profile
 * @returns {string}
 */
function resolveUserId(profile) {
  const map = loadProfileMap();
  if (!map[profile]) {
    map[profile] = `pi-${profile}-${randomUUID().slice(0, 8)}`;
    saveProfileMap(map);
  }
  return map[profile];
}

// --- server auto-start (lazy, shared-server posture) -----------------------
//
// BABA_Always_Bypasses_Anti-bot talks to a *shared*, long-lived camofox-browser daemon (stable
// fingerprint, logged-in profiles reused across Pi sessions). It is NOT a
// per-session server like PiFox's. But requiring a human to run
// deploy/start-camofox-browser.sh first is real setup friction for a casual
// `pi install npm:baba_always_bypasses_anti-bot` user. So: on the first connection error to a
// LOCAL server, transparently spawn the launcher (idempotent -- its pgrep
// guard makes double-spawn safe) and poll /health until it answers, then
// retry the call once. No shutdown hook -- the server's 1h idle timeout is
// the teardown, and killing it on Pi exit would defeat the shared posture.
//
// Skipped entirely when CAMOFOX_URL points at a non-local host (you're
// driving a remote server; we won't spawn a local one).

const STARTER_SCRIPT = path.join(EXTENSION_ROOT, "deploy", "start-camofox-browser.sh");

/** True iff BASE_URL targets localhost / 127.0.0.1 (or unset -> default). */
function isLocalServer() {
  let host = "localhost";
  try {
    host = new URL(BASE_URL).hostname.toLowerCase();
  } catch {
    // leave default
  }
  return host === "localhost" || host === "127.0.0.1" || host === "";
}

/** fetch with a hard timeout (ms). Node-safe (no AbortSignal.timeout dep). */
function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** Cheap liveness probe. Never throws. */
async function isServerUp() {
  try {
    const res = await fetchWithTimeout(
      `${BASE_URL}/health`,
      { method: "GET", headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {} },
      1500
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Single in-flight start promise so parallel tool calls don't multi-spawn.
let ensurePromise = null;

async function ensureServerUp() {
  if (await isServerUp()) return;
  if (!fs.existsSync(STARTER_SCRIPT)) {
    throw new Error(
      `camofox: server not running at ${BASE_URL} and launcher missing ` +
        `(${STARTER_SCRIPT}). Start it manually or reinstall the package.`
    );
  }
  process.stderr.write(
    `camofox: server not reachable at ${BASE_URL} -- starting it via ${STARTER_SCRIPT} (this can take 10-60s on a cold start)\n`
  );
  // Fire-and-forget detached spawn. The script itself nohup's the server and
  // returns; we don't wait on its exit (it can exit 1 "already running" under
  // a race, which is fine). The /health poll below is the source of truth.
  const child = spawn(STARTER_SCRIPT, [], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.on("error", (e) => {
    // surfaced via the poll timing out below; nothing else to do here
    process.stderr.write(`camofox: launcher spawn failed: ${e.message}\n`);
  });
  child.unref();

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (await isServerUp()) return;
  }
  throw new Error(
    `camofox: server did not come up at ${BASE_URL} within 60s. ` +
      `Check /tmp/camofox-browser.log and ${STARTER_SCRIPT}.`
  );
}

function ensureServerUpLocked() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    try {
      await ensureServerUp();
    } finally {
      ensurePromise = null;
    }
  })();
  return ensurePromise;
}

/** True for connection-level failures (server down), false for HTTP errors. */
function isConnError(err) {
  if (!err) return false;
  if (err.status) return false; // got an HTTP response -> server is up
  const msg = String(err.message || "");
  const cause = err.cause ? String(err.cause.code || err.cause.message || "") : "";
  return /ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|Failed to fetch|NetworkError/i.test(
    `${msg} ${cause}`
  );
}

// --- REST client ------------------------------------------------------------

/**
 * Raw call to the camofox-browser REST API. Throws on non-2xx with
 * `.status`/`.body`; throws a TypeError on connection failure.
 * @param {string} pathname
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function rawCamofoxFetch(pathname, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`${pathname} -> HTTP ${res.status}: ${body}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Call the camofox-browser REST API with lazy local-server auto-start.
 * On a connection error to a local server, starts the shared daemon and
 * retries once. @see rawCamofoxFetch for the raw behaviour.
 * @param {string} pathname
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function camofoxFetch(pathname, opts = {}) {
  try {
    return await rawCamofoxFetch(pathname, opts);
  } catch (err) {
    if (!isConnError(err) || !isLocalServer()) throw err;
    await ensureServerUpLocked();
    return rawCamofoxFetch(pathname, opts); // retry once after the server is up
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {number} [minMs] @param {number} [maxMs] */
function humanDelay(minMs = 250, maxMs = 700) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

// --- client factory: per-tab helpers bound to a userId ----------------------

// Retry a camofox action on transient "page changed" (HTTP 409) errors.
// ChatGPT/Gemini pages mutate constantly (auto-scroll, tooltips, streaming),
// so Playwright's actionability check can race with a DOM change. Selector-
// based clicks are safe to simply retry after a short settle delay.
async function withClickRetry(fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err.status === 409 || /page_changed|Page changed/i.test(err.message || "");
      if (!retryable) throw err;
      await sleep(350 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Per-tab helper set bound to a userId. Used by the skills; src/index.ts uses
 * camofoxFetch + toResult directly per-tool instead.
 * @param {string} userId
 */
function createClient(userId) {
  const fetch_ = (pathname, opts) => camofoxFetch(pathname, opts);

  // Evaluate a JS expression in the tab; returns the raw result value.
  async function evaluate(tabId, expression) {
    const r = await camofoxFetch(`/tabs/${tabId}/evaluate`, {
      method: "POST",
      body: JSON.stringify({ userId, expression }),
    });
    return r.result;
  }

  async function navigate(tabId, url) {
    return camofoxFetch(`/tabs/${tabId}/navigate`, {
      method: "POST",
      body: JSON.stringify({ userId, url }),
    });
  }

  async function click(tabId, selector) {
    return withClickRetry(() =>
      camofoxFetch(`/tabs/${tabId}/click`, {
        method: "POST",
        body: JSON.stringify({ userId, selector }),
      })
    );
  }

  async function type(tabId, selector, text, opts = {}) {
    return withClickRetry(() =>
      camofoxFetch(`/tabs/${tabId}/type`, {
        method: "POST",
        body: JSON.stringify({
          userId,
          selector,
          text,
          mode: opts.mode,
          delay: opts.delay,
          clear: opts.clear,
          submit: opts.submit,
        }),
      })
    );
  }

  async function press(tabId, key) {
    return camofoxFetch(`/tabs/${tabId}/press`, {
      method: "POST",
      body: JSON.stringify({ userId, key }),
    });
  }

  // Reuse an existing tab for this sessionKey that is already on the same
  // site (host) as the target url, else create one. Host matching is needed
  // because several sites can share one profile (e.g. chatgpt.com and
  // gemini.google.com both -> "gmail") -- matching on sessionKey alone would
  // let one skill steal another's tab. The server's POST /tabs always creates
  // a new tab, so listing first avoids accumulating orphan tabs across runs.
  async function getOrCreateTab(sessionKey, url) {
    let targetHost = "";
    try {
      targetHost = new URL(url).hostname.toLowerCase();
    } catch {
      // unparseable url -> match on sessionKey only
    }
    try {
      const list = await camofoxFetch(`/tabs?userId=${encodeURIComponent(userId)}`);
      const existing = (list.tabs || []).find((t) => {
        if ((t.listItemId || t.sessionKey) !== sessionKey) return false;
        if (!targetHost) return true;
        let h = "";
        try {
          h = new URL(t.url || "").hostname.toLowerCase();
        } catch {
          // tab with no url yet -> don't reuse by host
        }
        return h === targetHost;
      });
      if (existing) return { tabId: existing.tabId, created: false };
    } catch {
      // listing failed -> fall through to create
    }
    const tab = await camofoxFetch("/tabs", {
      method: "POST",
      body: JSON.stringify({ userId, listItemId: sessionKey, url }),
    });
    return { tabId: tab.tabId, created: true };
  }

  return {
    userId,
    fetch: fetch_,
    evaluate,
    navigate,
    click,
    type,
    press,
    getOrCreateTab,
  };
}

module.exports = {
  BASE_URL,
  DATA_DIR,
  PROFILES_PATH,
  HARNESS_CONFIG_PATH,
  loadHarnessConfig,
  loadProfileMap,
  saveProfileMap,
  resolveProfileForUrl,
  resolveUserId,
  camofoxFetch,
  sleep,
  humanDelay,
  createClient,
};
