// camofox.ts
//
// Pi extension for camofox-browser (https://github.com/jo-inc/camofox-browser).
// See camofox-README.md alongside this file for setup and usage.
//
// Provides:
//   1. Native API tools (camofox_open, camofox_snapshot, camofox_click, ...)
//      so Pi calls camofox-browser directly instead of guessing curl syntax.
//   2. Named "profiles" (e.g. "linkedin") instead of raw userId strings, so
//      logins persist across sessions under a human-readable name.
//   3. A bundled camofox-browser skill (skills/camofox-browser/SKILL.md)
//      carrying the usage guidance (profiles, macros, confirmed API facts)
//      that used to be injected into the system prompt. It is registered
//      via the resources_discover event, the same mechanism pi uses for
//      user-authored skills.
//
// API note: written against pi 0.83's registerTool shape (TypeBox
// `parameters`, `execute(toolCallId, params, signal, onUpdate, ctx)`
// returning `{ content, details }`). The older `handler` + JSON-schema
// shape no longer works on this pi version.

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

// Shared profile/userId resolution + REST client. Lives in lib/ so both this
// extension and the skills/ scripts use the exact same code (and therefore the
// same logged-in camofox-browser sessions) -- no duplicated logic. CommonJS
// module; jiti (which loads this ESM-syntax TS) provides the CJS named-export
// interop. See lib/camofox-client.js for the implementations.
import {
  resolveProfileForUrl,
  resolveUserId,
  camofoxFetch,
  loadProfileMap,
  DATA_DIR,
} from "../lib/camofox-client.js";
// Re-export to preserve this module's public API.
export { resolveProfileForUrl, DATA_DIR };

// Bundled usage guidance ships as a skill (skills/camofox-browser/SKILL.md),
// discovered via the resources_discover event below -- the same mechanism pi
// uses for user-authored skills. The entry point lives in src/, so the skills
// dir is one level up.
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

// All harness state lives in <extension>/.camofox (this repo, git-ignored),
// NOT ~/.camofox: the pi profile map here, and -- via the CAMOFOX_*_DIR envs
// exported by deploy/start-camofox-browser.sh -- the server's browser
// profiles, cookies, traces and the vnc-fit stable fingerprint. Moving the
// checkout moves every bit of login state with it. (DATA_DIR now comes from
// lib/camofox-client.js.)

// camofox-browser >= 1.13 requires `userId` on every per-tab endpoint
// (snapshot/click/type/navigate/screenshot/stats/close), not just on open.
// The pi tools only carry a tabId, so we track which userId owns each tab:
// remembered at open time, else discovered by scanning the tab list of each
// known profile. Map persists in <extension>/.camofox/tab-owners.json.
const TAB_OWNERS_PATH = join(DATA_DIR, "tab-owners.json");

function loadTabOwners(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(TAB_OWNERS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function rememberTabOwner(tabId: string, userId: string) {
  if (!tabId || !userId) return;
  const map = loadTabOwners();
  map[tabId] = userId;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TAB_OWNERS_PATH, JSON.stringify(map, null, 2));
}

async function resolveUserIdForTab(tabId: string): Promise<string> {
  const owners = loadTabOwners();
  if (owners[tabId]) return owners[tabId];
  for (const userId of Object.values(loadProfileMap())) {
    try {
      const data: any = await camofoxFetch(`/tabs?userId=${userId}`);
      if (data?.tabs?.some((t: any) => t.tabId === tabId)) {
        rememberTabOwner(tabId, userId);
        return userId;
      }
    } catch {
      // profile may have no live session yet -- keep scanning
    }
  }
  throw new Error(
    `camofox: cannot determine the owning profile for tab ${tabId} ` +
      `(camofox-browser requires userId on per-tab calls). Open the tab via camofox_open first.`
  );
}

// Wrap an async fetch result into the tool result shape pi 0.83 expects.
async function toResult(path: string, opts?: RequestInit) {
  const data = await camofoxFetch(path, opts);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    details: {} as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: any) {
  // --- bundled usage guidance, shipped as a skill ---
  pi.on("resources_discover", () => {
    return { skillPaths: [SKILLS_DIR] };
  });

  // --- tab lifecycle, profile-aware ---
  pi.registerTool({
    name: "camofox_open",
    description:
      "Open a URL under a named profile. Reuses saved login/session state automatically if this profile has one. " +
      "profile is optional: omit it to auto-resolve from the URL via ~/.pi/agent/camoufox-harness.json " +
      "(longest siteToProfile domain-suffix match, else defaultProfile, else 'default'); an explicit profile always wins.",
    parameters: Type.Object({
      profile: Type.Optional(Type.String({ description: "Stable label, e.g. 'linkedin', 'default'" })),
      url: Type.String(),
    }),
    async execute(_id: string, params: { profile?: string; url: string }) {
      const profile = params.profile || resolveProfileForUrl(params.url);
      const userId = resolveUserId(profile);
      const result = await toResult("/tabs", {
        method: "POST",
        body: JSON.stringify({ userId, listItemId: profile, url: params.url }),
      });
      try {
        const parsed = JSON.parse((result.content[0] as { text: string }).text);
        rememberTabOwner(parsed?.tabId, userId);
      } catch {
        // non-fatal: ownership just falls back to profile scanning
      }
      return result;
    },
  });

  pi.registerTool({
    name: "camofox_list_tabs",
    description: "List open tabs for a profile.",
    parameters: Type.Object({
      profile: Type.String(),
    }),
    async execute(_id: string, params: { profile: string }) {
      return toResult(`/tabs?userId=${resolveUserId(params.profile)}`);
    },
  });

  pi.registerTool({
    name: "camofox_close_tab",
    description: "Close a tab by id.",
    parameters: Type.Object({
      tabId: Type.String(),
    }),
    async execute(_id: string, params: { tabId: string }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(`/tabs/${params.tabId}?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
    },
  });

  // --- page interaction ---
  pi.registerTool({
    name: "camofox_snapshot",
    description: "Get an accessibility snapshot of a tab with stable element refs for clicking/typing.",
    parameters: Type.Object({
      tabId: Type.String(),
      includeScreenshot: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: { tabId: string; includeScreenshot?: boolean }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(
        `/tabs/${params.tabId}/snapshot?includeScreenshot=${!!params.includeScreenshot}&userId=${encodeURIComponent(userId)}`
      );
    },
  });

  pi.registerTool({
    name: "camofox_click",
    description:
      "Click an element. Prefer ref (from a snapshot) during live exploration; prefer selector " +
      "(CSS) when writing a reusable workflow script, since refs are ephemeral per-snapshot and " +
      "selectors are stable across runs. coordinates is a last-resort fallback.",
    parameters: Type.Object({
      tabId: Type.String(),
      ref: Type.Optional(Type.String({ description: "Element ref, e.g. 'e3'. Only valid for the snapshot it came from." })),
      selector: Type.Optional(Type.String({ description: "CSS selector, e.g. 'button[type=submit]'. Stable across runs." })),
      doubleClick: Type.Optional(Type.Boolean()),
      coordinates: Type.Optional(
        Type.Object({
          x: Type.Number(),
          y: Type.Number(),
        })
      ),
    }),
    async execute(_id: string, params: { tabId: string; ref?: string; selector?: string; doubleClick?: boolean; coordinates?: { x: number; y: number } }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(`/tabs/${params.tabId}/click`, {
        method: "POST",
        body: JSON.stringify({
          userId,
          ref: params.ref,
          selector: params.selector,
          doubleClick: params.doubleClick,
          coordinates: params.coordinates,
        }),
      });
    },
  });

  pi.registerTool({
    name: "camofox_type",
    description:
      "Type text into an element by ref or CSS selector. Prefer selector for reusable workflow scripts.",
    parameters: Type.Object({
      tabId: Type.String(),
      ref: Type.Optional(Type.String()),
      selector: Type.Optional(Type.String()),
      text: Type.String(),
      clear: Type.Optional(Type.Boolean({ description: "Clear the field before typing." })),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
    }),
    async execute(_id: string, params: { tabId: string; ref?: string; selector?: string; text: string; clear?: boolean; submit?: boolean }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(`/tabs/${params.tabId}/type`, {
        method: "POST",
        body: JSON.stringify({
          userId,
          ref: params.ref,
          selector: params.selector,
          text: params.text,
          clear: params.clear,
          submit: params.submit,
        }),
      });
    },
  });

  pi.registerTool({
    name: "camofox_navigate",
    description: "Navigate a tab to a URL, or use a search macro like @google_search.",
    parameters: Type.Object({
      tabId: Type.String(),
      url: Type.Optional(Type.String()),
      macro: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
    }),
    async execute(_id: string, params: { tabId: string; url?: string; macro?: string; query?: string }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(`/tabs/${params.tabId}/navigate`, {
        method: "POST",
        body: JSON.stringify({ userId, url: params.url, macro: params.macro, query: params.query }),
      });
    },
  });

  pi.registerTool({
    name: "camofox_screenshot",
    description: "Take a screenshot of the current tab state.",
    parameters: Type.Object({
      tabId: Type.String(),
    }),
    async execute(_id: string, params: { tabId: string }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(`/tabs/${params.tabId}/screenshot?userId=${encodeURIComponent(userId)}`);
    },
  });

  pi.registerTool({
    name: "camofox_tab_stats",
    description:
      "Get stats for a tab: tool call count and visited URLs. Useful when reconstructing an " +
      "interactive session into a reusable workflow script.",
    parameters: Type.Object({
      tabId: Type.String(),
    }),
    async execute(_id: string, params: { tabId: string }) {
      const userId = await resolveUserIdForTab(params.tabId);
      return toResult(`/tabs/${params.tabId}/stats?userId=${encodeURIComponent(userId)}`);
    },
  });
}
