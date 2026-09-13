---
title: Setup
summary: Open this when you are installing, upgrading, or uninstalling the GhostFox extension, or when you need to set CAMOFOX_URL / CAMOFOX_API_KEY so the extension can reach the camofox-browser server.
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
[server.md](server.md).

## Install the extension

Requires a running [camofox-browser](https://github.com/jo-inc/camofox-browser)
instance (`npm start` in that repo, or Docker/Fly/Railway). Default:
`http://localhost:9377`.

**From npm** (once published):

```bash
pi install npm:ghostfox
```

**From git** (no publish required):

```bash
pi install git:github.com/whispers-from-space/GhostFox
```

**Project-local instead of global:**

```bash
pi install -l npm:ghostfox
```

Then `/reload` inside Pi (or start a new session).

### Manual / local dev install

```bash
git clone https://github.com/whispers-from-space/GhostFox
cd GhostFox
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
published to npm (`pi install npm:ghostfox`).

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
