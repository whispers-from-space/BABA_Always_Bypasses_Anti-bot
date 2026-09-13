---
title: Tools
summary: Open this when you want the exact list of camofox_* tools this extension registers, their parameters, or end-to-end usage examples showing the typical open → snapshot → click/type flow.
---

# Tools

The tools below are registered by this extension and called automatically by
the LLM (no slash command needed). The extension derives the camofox-browser
`userId` from a `profile` label for you — see [profiles.md](profiles.md) and
[architecture.md](architecture.md).

## Tool set

> **Accuracy note (2024 audit):** the previous README listed a
> `camofox_import_cookies` tool here. That tool is **not registered by this
> extension** — there is no cookie-import code in `src/`, `deploy/`, or
> `skills/`. The cookie-import flow is an *upstream camofox-browser* feature
> this extension does not wrap; see [profiles.md](profiles.md) for the login
> paths that actually work and [troubleshooting.md](troubleshooting.md) for
> the upstream `/sessions/:userId/cookies` caveats.

| Tool | Does |
|---|---|
| `camofox_open` | Open a URL under a named profile (profile optional — auto-resolved from the URL, see [profiles.md](profiles.md)) |
| `camofox_list_tabs` | List open tabs for a profile |
| `camofox_close_tab` | Close a tab |
| `camofox_snapshot` | Accessibility snapshot with element refs (e1, e2...) |
| `camofox_click` | Click an element by ref / CSS selector / coordinates |
| `camofox_type` | Type into an element by ref / CSS selector |
| `camofox_navigate` | Navigate to a URL or a search macro (`@google_search`, etc.) |
| `camofox_screenshot` | Screenshot the current tab |
| `camofox_tab_stats` | Stats for a tab: tool call count and visited URLs. Useful when reconstructing an interactive session into a reusable workflow script |

### Per-tab endpoints all carry `userId`

camofox-browser ≥ 1.13 requires `userId` on every per-tab endpoint
(`snapshot`/`click`/`type`/`navigate`/`screenshot`/`stats`/`close`), not just
on `open`. The extension's tools only carry a `tabId`, so it tracks which
`userId` owns each tab: remembered at `camofox_open` time, else discovered by
scanning the tab list of each known profile (see `tab-owners.json` in
[data.md](data.md)). Every tool in this package forwards `userId`
automatically; if you add tools of your own against the REST API, don't drop
it — append `?userId=<profile-resolved-id>`.

## Typical flow

Normal browsing (LLM decides the steps, calling tools as needed):

```
You: Open example.com under a profile called "scratch" and tell me what's on the page.
Pi: [calls camofox_open(profile: "scratch", url: "https://example.com")]
    [calls camofox_snapshot(tabId: ...)]
    The page shows...
```

`camofox_open` → `camofox_snapshot(tabId)` (for element refs `e1`, `e2`…) →
`camofox_click` / `camofox_type` using those refs. Refs are valid only until
the next navigation; use a CSS `selector` instead of `ref` when writing a
reusable script (selectors are stable across runs). See the bundled
`skills/camofox-browser/SKILL.md` for the full macro list and reusable-script
guidance.

## Endpoints this extension does NOT wrap

These exist upstream and could be added; see the
[upstream API table](https://github.com/jo-inc/camofox-browser#api):

- `press`, `scroll`, `wait`, `back`/`forward`/`refresh`
- `links`, `images`, `downloads`, `extract` (structured JSON-Schema extraction)
- session tracing, YouTube transcript extraction
- `/sessions/:userId/cookies` (cookie import) and
  `/sessions/:userId/storage_state` — see [troubleshooting.md](troubleshooting.md)
- `/tabs/:id/evaluate` (raw JS) — used internally by `deploy/wake-browser.sh`

There is **no retry/backoff** on the extension's fetch helper yet — a
transient failure just throws with a message pointing at `CAMOFOX_URL`. Fine
for interactive use; worth hardening for unattended runs.
