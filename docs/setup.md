---
title: Setup
summary: Open this when you are installing, upgrading, or uninstalling the BABA_Always_Bypasses_Anti-bot extension, or when you need to set CAMOFOX_URL / CAMOFOX_API_KEY so the extension can reach the camofox-browser server.
---

# Setup

## Dependency: a running camofox-browser server

This project **depends on a running [camofox-browser](https://github.com/jo-inc/camofox-browser)
server** (npm package [`@askjo/camofox-browser`](https://www.npmjs.com/package/@askjo/camofox-browser),
validated against `^1.13.0`). The extension is a REST *client* — it calls the
server's HTTP API and never bundles or embeds it, so the dependency is
declared as an optional peer dependency rather than a hard one. The server
must be reachable at `CAMOFOX_URL` (default `http://localhost:9377`) for any
`camofox_*` tool to work.

The server is started with `deploy/start-camofox-browser.sh` — see
[server.md](server.md). **You usually don't have to start it by hand**: on the
first `camofox_*` call, if the local server isn't reachable, the extension
spawns the launcher itself and polls `/health` until it's up (cold start can
take 10–60s), then retries the call. This only happens for a *local* server
(`localhost`/`127.0.0.1` or the default); if `CAMOFOX_URL` points at a remote
host, no local process is spawned. The server is a shared, long-lived daemon
(idle-shutdown after 1h) and is **not** torn down when Pi exits — that's the
whole point of the shared-fingerprint / shared-profile posture. Run the
launcher manually only if you want to pre-warm it or override its env vars.

## Install the extension

A local [camofox-browser](https://github.com/jo-inc/camofox-browser) server is
auto-started on first use (see above) — no manual setup needed for the
default localhost posture. Point `CAMOFOX_URL` at a remote instance instead if
you run one (Docker/Fly/Railway).

**From npm** (once published):

```bash
pi install npm:baba_always_bypasses_anti-bot
```

**From git** (no publish required):

```bash
pi install git:github.com/whispers-from-space/BABA_Always_Bypasses_Anti-bot
```

**Project-local instead of global:**

```bash
pi install -l npm:baba_always_bypasses_anti-bot
```

Then `/reload` inside Pi (or start a new session).

### Manual / local dev install

```bash
git clone https://github.com/whispers-from-space/BABA_Always_Bypasses_Anti-bot
cd BABA_Always_Bypasses_Anti-bot
npm install
pi -e ./src/index.ts   # try it without installing
```

To use your local checkout as a **project-local** extension (loaded in place —
no copy, edits apply on `/reload`):

```bash
pi install -l .   # registers this repo in .pi/settings.json
```

For a global install (all projects), either copy the repo to
`~/.pi/agent/extensions/` or `pi install <path-to-this-repo>` once it's
published to npm (`pi install npm:baba_always_bypasses_anti-bot`).

Then `/reload` in Pi (or start a new session).

## Client environment variables

These configure *this extension's client requests* — they are separate from
any same-named variables you set when starting the camofox-browser server
itself (see the launcher's config block in [server.md](server.md)):

| Variable | Purpose | Default |
|---|---|---|
| `CAMOFOX_URL` | Base URL of the camofox-browser server | `http://localhost:9377` |
| `CAMOFOX_API_KEY` | Bearer token, if your camofox-browser instance requires auth (`CAMOFOX_AUTH_MODE=required`, or non-loopback binds) | unset |

When `CAMOFOX_API_KEY` is set, the extension sends it as
`Authorization: Bearer <key>` on every request it makes.
