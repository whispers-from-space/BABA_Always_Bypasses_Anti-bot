---
title: Profiles & login
summary: Open this when you are configuring ~/.pi/agent/camoufox-harness.json (URL→profile mapping, defaultProfile), or when you need to get a profile logged into a site — the VNC manual-login flow, and why cookie import is not a login path this extension provides.
---

# Profiles & login

## What a "profile" is

camofox-browser identifies sessions by an arbitrary `userId` string and
persists cookies/localStorage per `userId` under
`<extension>/.camofox/profiles/` automatically. This extension adds one
layer on top: a **profile name** (e.g. `"linkedin"`) that maps to a stable,
generated `userId`, stored at `<extension>/.camofox/pi-profiles.json`. You
(and the LLM) only ever refer to `"linkedin"` — the extension resolves it to
the same underlying `userId` every time, so login state persists across
sessions without you tracking opaque IDs.

Server-side, the persistence plugin maps each `userId` to a deterministic
SHA256-hashed subdirectory under `CAMOFOX_PROFILE_DIR` (default
`<extension>/.camofox/profiles/`), so per-site
cookies/localStorage/IndexedDB survive server restarts.

> The profile-concept is explained end-to-end (sessions, BrowserContexts,
> the single VNC display, stale-tab cleanup) in
> [architecture.md](architecture.md). This file covers *configuring* profiles
> and *logging them in*.

## URL → profile mapping

`~/.pi/agent/camoufox-harness.json` controls which profile a URL opens under
when `camofox_open` is called **without** an explicit `profile`:

```json
{
  "defaultProfile": "default",
  "siteToProfile": {
    "claude.ai": "google",
    "gemini.google.com": "google",
    "zhipin.com": "zhipin"
  }
}
```

Resolution order (`resolveProfileForUrl` in `src/index.ts`):

1. Parse the URL's hostname.
2. Domain-suffix match against `siteToProfile` keys — the hostname must equal a
   key or end with `.` + key (`www.claude.ai` matches `claude.ai`,
   `notclaude.ai` does not). **Longest matching key wins**, so a
   `gemini.google.com` entry overrides a broader `google.com` one.
3. No match → `defaultProfile`.
4. No `defaultProfile` set → `"default"`.

An explicit `profile` argument always beats the mapping.
`deploy/wake-browser.sh` uses the same `defaultProfile` when called without
`--profile` (see [server.md](server.md)). Profiles referenced by the mapping
are auto-created on first use (same `pi-<name>-<hex>` scheme as any other
profile).

## Getting a profile logged in

### VNC manual login (the path this deployment wires up)

VNC is **ON by default on this deployment** — the server is launched via
`deploy/start-camofox-browser.sh` with `ENABLE_VNC=1`.

Open the site under a profile — `camofox_open(profile: "linkedin", url: ...)`
or `./deploy/wake-browser.sh --profile linkedin https://www.linkedin.com` —
then open `http://localhost:6080/vnc.html` and click through the login
manually. The server treats noVNC mouse/keyboard input on that tab exactly
like API actions, so the login persists to the same profile automatically;
no confirm/backup step.

Persistence timing caveats: storage state is checkpointed on session destroy
(incl. idle reaping) and server shutdown — **not continuously**, so a fresh
VNC login reaches disk only when the session ends or the server stops (a
SIGKILL in between loses it). Also, the vnc-fit plugin keeps a *stable*
device fingerprint across restarts (see [server-internals.md](server-internals.md));
without it, Camoufox would re-roll its fingerprint on every browser launch
and some security-sensitive sites that bind sessions to device signals could
demand re-login after a restart even though the cookies were restored
correctly.

Any tab the agent opened under a profile works the same way: log in on it via
VNC and the login persists to that profile, reusable later via
`camofox_open(profile: "<name>")` with no extra steps. The wake tab is no
different — `--profile <name>` just picks which profile the wake tab lives
under (default name from `defaultProfile`, else `default`; auto-created in
`pi-profiles.json`).

> **VNC is a server *startup* flag, not something any client can switch on
> remotely.** It cannot be turned on per-profile or per-session. If your
> server was started without `ENABLE_VNC=1`, VNC manual login won't work —
> start/restart the server with the launcher. (This fact is stated once here
> and not repeated elsewhere; see [architecture.md](architecture.md) for the
> single-shared-display consequence.)

### Cookie import — NOT wrapped by this extension

The previous README described cookie import as a second login path with a
`camofox_import_cookies` tool. **That tool is not registered by this
extension** (verified in `src/index.ts`). The underlying capability is an
*upstream* camofox-browser endpoint (`POST /sessions/:userId/cookies`) that
this package simply does not wrap.

If you need it, the factual upstream behaviour is documented in
[troubleshooting.md](troubleshooting.md) (it requires `CAMOFOX_API_KEY` on
both sides, enforces a 500-cookie / 5MB cap, etc.) — but you would have to
call that endpoint yourself over HTTP; no `camofox_*` tool does it for you.
