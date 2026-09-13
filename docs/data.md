---
title: Data directory
summary: Open this when you need to know what lives under <extension>/.camofox/ — which files are login state vs config, what is git-ignored, and what is safe to move or delete (including the tab-owners.json map the per-tab tools rely on).
---

# Data directory

All harness state lives in `<extension>/.camofox/` (inside this repo,
git-ignored) — **not** `~/.camofox`. `deploy/start-camofox-browser.sh`
exports `CAMOFOX_DATA_DIR` (plus `CAMOFOX_PROFILE_DIR`,
`CAMOFOX_COOKIES_DIR`, `CAMOFOX_TRACES_DIR`,
`CAMOFOX_STABLE_FINGERPRINT_PATH`) pointing there, and the extension
resolves its own profile map from the same directory. Moving the checkout
moves all login state with it. **Never commit this directory** — it contains
live session cookies; it is covered by `.gitignore`.

(Note: the Camoufox binary itself recreates an *empty* `~/.camoufox/` on
every launch — that's its hardcoded default root; no state is stored there
on this deployment.)

| Path | Contents |
|---|---|
| `.camofox/profiles/` | per-userId browser storage (cookies/localStorage/IndexedDB), one SHA256-hashed subdir per userId |
| `.camofox/pi-profiles.json` | profile name → userId map (the extension's `resolveUserId`) |
| `.camofox/tab-owners.json` | tabId → userId map, used by the per-tab tools (`snapshot`/`click`/`type`/`navigate`/`screenshot`/`stats`/`close`) to forward the `userId` camofox-browser requires. Remembered at `camofox_open` time; falls back to scanning each known profile's tab list. Safe to delete — it is rebuildable, but deleting it forces that scan on the next per-tab call. |
| `.camofox/stable-fingerprint.json` | vnc-fit's stable device fingerprint (see [server-internals.md](server-internals.md)) |
| `.camofox/cookies/` | drop-zone for Netscape `cookies.txt` imports — **unused by this extension** (cookie import is not wrapped; see [profiles.md](profiles.md)), but the launcher still points `CAMOFOX_COOKIES_DIR` here for the upstream server. |
| `.camofox/traces/` | session traces |

The launcher-side env vars that set these locations are documented in the
config table in [server.md](server.md).
