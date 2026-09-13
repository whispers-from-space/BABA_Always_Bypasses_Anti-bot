# GhostFox — Agent Guide

> Context file for AI coding agents (pi / Claude Code / Codex / etc.) working in
> this repo. Read this before editing. Pi auto-loads it at startup; other agents
> load it by convention.

## What this is

GhostFox is a [Pi](https://pi.dev) extension that wraps a running
[camofox-browser](https://github.com/jo-inc/camofox-browser) server's REST API
as Pi tools, with **named profiles** (login/session persistence) and a **VNC
manual-login** path for sites that need a human to click through auth once.

It is a REST **client** — it never bundles or embeds the browser server. The
server is a separate process started by `deploy/start-camofox-browser.sh`.

## Layout

```
src/index.ts          Extension entry point: registers the camofox_* tools and
                      the resources_discover hook that ships the bundled skills.
lib/camofox-client.js SHARED CommonJS module — profile/userId resolution + REST
                      client. Used by BOTH the extension (TS, via jiti interop)
                      AND the skills (plain .js via require()). Single source of
                      truth: edit here, not in copies.
skills/               Bundled skills, discovered at runtime via resources_discover.
  camofox-browser/      Usage guidance for the camofox_* tools (auto-invoked).
  ask-chatgpt/          `/skill:ask-chatgpt` — relay a question to ChatGPT's web UI.
  ask-claude/           `/skill:ask-claude`    — relay a question to Claude's web UI.
  ask-gemini/           `/skill:ask-gemini`     — relay a question to Gemini's web UI.
deploy/               Server launcher + VNC plugin.
  start-camofox-browser.sh  Starts the camofox-browser server (VNC ON by default).
  wake-browser.sh           Wakes the browser after idle shutdown.
  camofox-vnc-fit/          Plugin source: pins fingerprint geometry to the VNC display.
docs/                 Progressive-disclosure docs. Start at docs/INDEX.md.
```

## Key invariants — do not break these

1. **`lib/camofox-client.js` is CommonJS on purpose.** The plain `.js` skills
   `require()` it directly; the TS extension `import`s it via jiti's CJS
   named-export interop. Do **not** convert it to ESM, add a build step, or add
   `"type": "module"` to `package.json` — either would break the skills.

2. **Profile → userId resolution must stay identical across the extension and
   the skills.** That is the whole reason `lib/` is shared: a skill reuses the
   *same logged-in session* that interactive `camofox_open` uses. If you change
   `resolveProfileForUrl` / `resolveUserId`, change it in `lib/` only.

3. **`userId` must be forwarded on every per-tab REST call.** camofox-browser
   ≥1.13 requires it on `snapshot`/`click`/`type`/`navigate`/`screenshot`/
   `stats`/`close`, not just `open`. The extension tracks tab→profile ownership
   in `.camofox/tab-owners.json` (rebuildable; falls back to scanning each
   profile's tab list). Never drop `userId` when adding a new tool.

4. **Never commit runtime/personal state.** `.camofox/` (cookies, browser
   profiles, stable fingerprint, `pi-profiles.json`, `tab-owners.json`),
   `.pi/` (session logs), and any `**/.state/` (skill conversation URLs) are
   git-ignored AND npm-ignored. They contain live session cookies / personal
   conversation URLs. See `.gitignore` + `.npmignore`.

## Commands

```bash
npm install            # install dev deps (pi types, typebox, typescript)
npx tsc --noEmit       # type-check the extension against installed pi types

# Run the browser server this extension talks to (VNC ON by default):
./deploy/start-camofox-browser.sh
#   API:  http://localhost:9377   ·   live view: http://localhost:6080/vnc.html

# Try the extension without installing:
pi -e ./src/index.ts

# Use this checkout as a project-local extension (loaded in place):
pi install -l .        # writes this repo into .pi/settings.json, then /reload
```

There is no test suite and no build step (jiti loads the TS directly).

## Client env vars

| Var | Purpose | Default |
|---|---|---|
| `CAMOFOX_URL` | Base URL of the camofox-browser server | `http://localhost:9377` |
| `CAMOFOX_API_KEY` | Bearer token if the server requires auth | unset |

These configure *this extension's* client requests only; they are separate from
the same-named server-side vars in `deploy/start-camofox-browser.sh`.

## Where to look for more

Don't read everything — pick by task in [`docs/INDEX.md`](docs/INDEX.md):

- Tools list + examples → [docs/tools.md](docs/tools.md)
- Profiles / login / VNC → [docs/profiles.md](docs/profiles.md)
- Server start/stop/debug → [docs/server.md](docs/server.md)
- On-disk state (what's git-ignored) → [docs/data.md](docs/data.md)
- Fork / rename / publish → [docs/contributing.md](docs/contributing.md)
