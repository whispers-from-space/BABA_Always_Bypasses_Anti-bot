---
name: camofox-browser
description: Use when browsing or automating a website via camofox_open, camofox_click, camofox_type, camofox_navigate, or camofox_snapshot, or when asked to turn an interactive exploration into a reusable workflow script.
---

# camofox-browser

A stealth browser server (Camoufox-based, anti-detection) is available via the
`camofox_*` tools. They return parsed JSON and handle profile-based session
identity for you — no raw curl/bash against the REST API.

## Concepts

- "profile" = a human-readable label (e.g. "linkedin", "amazon") that maps to a
  persistent camofox session. Reusing the same profile name reuses saved
  cookies/login state automatically. Never invent or track userId strings
  yourself — pass a profile name and the extension resolves it.
- `camofox_open` profile is OPTIONAL: omit it and the URL is mapped via
  `~/.pi/agent/camoufox-harness.json` (`siteToProfile` domain-suffix match,
  longest key wins → else `defaultProfile` → else "default"). Pass an
  explicit profile to override the mapping. Other tools keep requiring the
  profile name (they have no URL to resolve from).
- Typical flow: `camofox_open(url)` (or `camofox_open(profile, url)`) ->
  `camofox_snapshot(tabId)` for element refs (e1, e2, ...) -> `camofox_click`
  / `camofox_type` using those refs.
- If a page requires login and no saved session exists yet, tell the user to
  log in once (see Monitoring below), then reuse the same profile.

## Search macros

Pass to `camofox_navigate` as macro + query:
`@google_search` `@youtube_search` `@amazon_search` `@reddit_search`
`@reddit_subreddit` `@wikipedia_search` `@twitter_search` `@yelp_search`
`@spotify_search` `@netflix_search` `@linkedin_search` `@instagram_search`
`@tiktok_search` `@twitch_search`

## Confirmed facts (from this server's own openapi.json)

Do not assume features from unrelated forks or blog posts.

- `click`/`type` accept "ref" (from a snapshot, valid only until the next
  navigation) OR "selector" (CSS, stable across page loads and script runs).
- No built-in humanization: no randomized delay between actions, no simulated
  mouse movement path, no per-character typing pace. Actions fire essentially
  instantly once Playwright's normal actionability wait
  (visible/stable/enabled) is satisfied. Anti-detection here is entirely
  fingerprint-level (Camoufox/C++), not behavioral.
- Monitoring a session live is a server *startup* flag (ENABLE_VNC=1,
  NOVNC_PORT) — not a per-session API call. There is no toggle-display
  endpoint on this server. **On this deployment VNC is ON by default**
  (see `deploy/start-camofox-browser.sh`): open
  `http://localhost:6080/vnc.html` any time to watch the browser live.
  VNC binds to 127.0.0.1 only; x11vnc on 5900, noVNC web UI on 6080.
  Add a password via VNC_PASSWORD if the machine is shared.

## Writing a reusable workflow script

- Standalone script (Node.js) calling this REST API directly — not raw
  Playwright/Camoufox. The server already handles session lifecycle,
  fingerprint config, and profile persistence.
- Use "selector", not "ref" — refs from the exploration session are already
  stale by the time the script runs.
- Reuse the same profile name the exploration used, so the script inherits
  the already-persisted login automatically.
- Add a randomized delay between actions (e.g. 300-900ms) — the server adds
  none; this is a client-side concern entirely.
- `camofox_tab_stats` (GET /tabs/:id/stats) can help recall which URLs were
  visited during a long exploration session if needed.

Full schema is always available live at `<server>/openapi.json` (default
`http://localhost:9377`) for any endpoint not covered here (downloads, images,
traces, youtube transcript).
