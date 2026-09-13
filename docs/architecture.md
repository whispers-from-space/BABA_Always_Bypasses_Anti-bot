---
title: Architecture
summary: Open this when you need to know how a Pi session maps onto camofox-browser internals — userId vs profile, one BrowserContext per profile inside one shared browser, the single shared VNC display, and stale-tab cleanup timing.
---

# Architecture

How a Pi session maps onto camofox-browser internals (verified against the
server source and `src/index.ts`).

## Why "profile" instead of raw userId

camofox-browser identifies sessions by an arbitrary `userId` string and
persists cookies/localStorage per `userId`. This extension adds one layer:
a **profile name** (e.g. `"linkedin"`) that maps to a stable, generated
`userId` (`pi-<name>-<hex>`), stored at `<extension>/.camofox/pi-profiles.json`.
You and the LLM only ever refer to the profile name; the extension resolves
it to the same `userId` every time, so login state persists across sessions
without tracking opaque IDs. (The same fact is stated once here; configuring
profiles and the URL→profile mapping is covered in [profiles.md](profiles.md),
and the on-disk layout in [data.md](data.md).)

## Pi sessions, BrowserContexts, and profiles

1. **One shared server, one browser.** A single `camofox-browser` server
   (default `http://localhost:9377`) and a single Camoufox/Firefox process
   back **all** Pi sessions. There is one Xvfb virtual display and one
   `x11vnc` → noVNC web UI on `:6080` for the whole browser.

2. **`userId` = profile, not the Pi session.** Every camofox tool call is
   scoped by a `userId`. This extension derives it from the `profile` label
   via `pi-profiles.json` (e.g. `gmail` → `pi-gmail-e8dac02e`). It is **not**
   the Pi session id / agentId — changing Pi sessions does not change the
   userId for a given profile.

3. **One BrowserContext per profile.** Server-side, `getSession(userId)`
   calls `browser.newContext(...)` — one Playwright `BrowserContext` per
   `userId`, i.e. per profile, inside the shared browser. Contexts are
   isolated from each other at the cookie/localStorage/IndexedDB layer, and
   each profile's state is persisted under `.camofox/profiles/<sha256>/`.

4. **Profiles are shared across Pi sessions.** Because the userId is
   profile-based, two concurrent Pi sessions that use the **same** profile
   share the **same** BrowserContext (same cookies, same set of tabs). This
   is intentional — it is how login state is reused across sessions. Two
   sessions using **different** profiles get different, isolated contexts.
   Practical implication: closing one Pi session's context would kill
   another live session's tabs if they share the profile.

5. **API scoping.** `/tabs?userId=X` returns only profile X's tabs. Each Pi
   session sees only the profile(s) it uses; the server's `/health`
   `activeSessions` / `activeTabs` counters aggregate across all profiles.

6. **VNC shows the one browser, not per session.** noVNC mirrors the single
   X display = the single browser. There is **no** per-Pi-session or
   per-profile VNC stream, and no per-userId display isolation. (VNC itself
   is a server *startup* flag — `ENABLE_VNC=1` — not a per-session toggle;
   see [profiles.md](profiles.md) for the login-flow side of that.) Firefox
   paints only the foreground tab of its foreground window, so only one tab
   is visible at a time; tabs from other profiles exist as live tab
   processes but are not rendered. To view a specific profile's tab, raise
   it to the foreground — there is no API endpoint for that, so either click
   the tab strip inside noVNC or drive that tab via `camofox_navigate` /
   `camofox_snapshot` (which activates it).

7. **Stale-tab cleanup.** Ending a Pi session does **not** close its tabs
   immediately. The context lives until camofox-browser's inactivity reaper
   runs (`TAB_INACTIVITY_MS`, 1h here): inactive tabs are reaped, and once a
   context is empty it is closed and its storage state persisted. So a quit
   Pi session can leave tabs behind for up to ~1h. If you need immediate
   cleanup on Pi quit, a Pi extension can hook `session_shutdown` and call
   `DELETE /sessions/:userId` (see `openapi.json`) — but because of point 4,
   only do this with reference counting (close when the live-session count
   for the profile drops to 0), or you will kill another session's tabs.

## Tab grouping: `listItemId` vs `sessionKey`

Tabs are grouped per session by a session-scoped id:

- The extension's `camofox_open` passes `listItemId: <profile-name>`, so all
  tabs a profile opens share that group and are adopted by
  `(userId, listItemId)` when still open, else created fresh.
- `deploy/wake-browser.sh` instead posts `sessionKey: "wake"` (and pokes an
  existing tab via the `/evaluate` endpoint). It still resolves/creates the
  same real pi-profile `userId`, so a manual login done on the wake tab is
  reusable from the extension under that profile — the grouping key differs
  but the persistence bucket (`userId`) is identical.

## Scaling to a second server

If a specific site ever correlates/flags repeated fingerprint reuse across
its different logins, stand up a *second* dedicated instance (change
`CAMOFOX_PORT` in the launcher, point that site's workflow at it via
`CAMOFOX_URL` per-process) — this is the documented exception, not the
default.
