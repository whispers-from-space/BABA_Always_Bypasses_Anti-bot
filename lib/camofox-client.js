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

// --- REST client ------------------------------------------------------------

/**
 * Call the camofox-browser REST API. Throws on non-2xx with `.status`/`.body`.
 * @param {string} pathname
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function camofoxFetch(pathname, opts = {}) {
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
