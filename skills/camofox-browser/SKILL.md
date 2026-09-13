---
name: camofox-browser
description: Use when browsing or automating a website via the camofox_* tools, or when capturing a web workflow as a self-healing skill — either because the user asked to define a fixed web-automation workflow, or because the same series of actions is repeating in the conversation — and to maintain/fix those skills when they break.
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

## Fixed-workflow skills: capture, then self-heal

A fixed-step web workflow (log in, click through a few pages, scrape a table,
post a reply) should NOT be re-driven with LLM tokens every time. Capture it
once as a **skill**: a `SKILL.md` (the contract — when to use it, what the
next user message means, how to call the script) plus a wrapped Node script
that drives this REST API directly. Repeat runs then cost one bash call, not
a fresh exploration.

### When to capture (two triggers)

Capture a new workflow skill in either of these situations — not in any
other (don't pre-emptively skill-ify one-off tasks):

1. **The user defines the workflow.** The user explicitly asks to
   "save/capture/turn this into a skill", names a repeatable web task they
   want on tap ("post my daily standup to the portal", "pull yesterday's
   orders from the admin"), or hands you a fixed step-by-step procedure to
   automate. Build the skill from the steps they give or from one interactive
   run-through you do together first.
2. **A series of actions is repeating in the conversation.** You notice the
   *same* sequence of `camofox_*` calls (same profile, same URLs, same
   clicks/types) has already occurred in this session's context or message
   history — i.e. the user is running it a second time by hand, or you've
   just re-driven it. At the point you spot the repeat (before the second
   re-run finishes), pause and propose capturing it as a skill, then build
   it from the steps you can see in history. One captured run pays back on
   the very next invocation.

In both cases, tell the user what you captured and where, so they can edit or
invoke it (`/skill:<name>`) themselves next time.

### Pattern (copy a shipped example)

The bundled `ask-chatgpt`, `ask-claude`, and `ask-gemini` skills are exactly
this pattern — look at any of them as a template:

- `skills/ask-*/SKILL.md` — the contract (one-line description, when to
  invoke, what to relay to the user).
- `skills/ask-*/ask-*.js` — a standalone Node script that calls the camofox
  REST API via `lib/camofox-client.js` (`createClient(userId)`) and prints
  the result to stdout. The agent just runs it with bash.

### How to write one

- Explore the site interactively first (`camofox_open` → `camofox_snapshot`
  → `camofox_click`/`camofox_type`) to find the steps.
- Capture it as a script using **CSS selectors**, never refs — refs are valid
  only until the next navigation and are stale by the time a script runs.
  Selectors are stable across page loads and script runs.
- Reuse the same profile name the exploration used, so the script inherits
  the already-persisted login automatically — no auth in the script.
- Add a randomized delay between actions (e.g. 300-900ms) — the server adds
  none; this is entirely a client-side concern.
- Put the script + `SKILL.md` under `skills/<your-skill>/` and it is
  discoverable as `/skill:<your-skill>` (same `resources_discover` mechanism
  the ask-* skills use).
- `camofox_tab_stats` (GET /tabs/:id/stats) can help recall which URLs were
  visited during a long exploration session.

### Self-heal: fix the broken step, don't redo the workflow

When a site changes and the script breaks (a selector no longer matches, a
page flow changed), do NOT re-drive the whole workflow from scratch with
tokens. Fix just the broken step:

1. Run the script; note which step threw (have the script name the step in
   its error, e.g. `step "submit" : click "button.submit" failed`).
2. `camofox_open` the last good URL under the same profile, then
   `camofox_snapshot` to see the current DOM.
3. Find the new selector for that one step (or the new intermediate page),
   patch the script, re-run. The other steps' selectors are almost certainly
   still valid.
4. The fix persists — the script is the source of truth for next time.

This is the point of capturing workflows as skills: the agent maintains and
patches its own scripts instead of re-paying the exploration cost every run.

Full schema is always available live at `<server>/openapi.json` (default
`http://localhost:9377`) for any endpoint not covered here (downloads, images,
traces, youtube transcript).
