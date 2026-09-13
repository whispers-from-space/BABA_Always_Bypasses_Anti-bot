# GhostFox

A [Pi](https://pi.dev) extension that turns the [Camoufox](https://github.com/jo-inc/camofox-browser)
anti-fingerprint browser into **a full browser-automation layer for agents** —
where a human can log in by hand once (and the agent reuses that session
forever), watch the agent browse live to debug it, and relay questions to
ChatGPT / Claude / Gemini's web UIs through the same logged-in profiles.

```bash
pi install npm:ghostfox
```

## Why GhostFox

Most "stealth browser for agents" extensions give you a fetch-and-search
primitive over an anti-detect browser and stop there. GhostFox is built on
the opposite assumption: **the agent should drive the page**, and **a login
done once should stay done.**

- **Named profiles, real session persistence.** Each profile is its own
  `BrowserContext` with its own cookies/localStorage, persisted to disk and
  reused across Pi sessions. A URL→profile map (`~/.pi/agent/camoufox-harness.json`)
  auto-routes `camofox_open("https://linkedin.com")` to your `linkedin`
  profile with no extra config. Log in once → it stays logged in.

- **Log in by hand once, the agent reuses it forever.** Some sites need a
  human to click through OAuth, 2FA, or a Cloudflare checkpoint exactly once.
  GhostFox runs a live web view of the browser (`http://localhost:6080/vnc.html`)
  so you do that login yourself, and the resulting session is then reused by
  the agent tools with no extra steps. "Headless browser as a tool"
  extensions can't cover this case — they have no display, so a site that
  needs a human can never be logged in.

- **Watch the agent browse live, and debug it.** The same web view shows what
  the agent is doing in real time as it clicks, types, and navigates — so when
  a workflow goes wrong you can see exactly where, instead of guessing from a
  stack trace. Monitoring and debugging are first-class, not an afterthought.

- **Full agentic browser surface, not just fetch.** Nine native tools —
  `camofox_open` · `camofox_list_tabs` · `camofox_close_tab` · `camofox_snapshot`
  · `camofox_click` · `camofox_type` · `camofox_navigate` · `camofox_screenshot`
  · `camofox_tab_stats` — so the LLM snapshots the page, clicks elements by
  ref or CSS selector, types into fields, and navigates. Accessibility
  snapshots give stable element refs for clicking/typing. This is what makes
  real workflows (fill a form, scrape behind a login, drive a SPA) possible,
  not just "give me the HTML of this URL."

- **Bundled multi-assistant relay skills.** `ask-chatgpt`, `ask-claude`, and
  `ask-gemini` relay a question to that assistant's **web UI** — using the
  same logged-in camofox profile your interactive sessions use — and return
  its exact response. One Pi agent can query three frontier models through
  their real web frontends (with your paid subscriptions) without leaving
  the session. Ship a question to all three and compare.

- **Lazy auto-start, zero-config install.** `pi install npm:ghostfox` and
  just ask. On the first `camofox_*` call, if the local server isn't up, the
  extension spawns the launcher and polls `/health` until ready — no manual
  daemon setup. (Only fires for a local server; a remote `CAMOFOX_URL` is
  left alone.)

- **Shared-server posture, not per-session throwaway.** One long-lived
  Camoufox daemon with a **stable device fingerprint** serves many Pi
  sessions. Login state, cookies, and the fingerprint survive Pi restarts;
  the server idle-shuts-down after 1h of inactivity and is **not** killed
  when Pi exits — so the next session picks up exactly where the last one
  left off. This is the difference between "a browser" and "your browser."

- **Anti-fingerprint by construction.** Built on Camoufox — a Firefox fork
  patched at the C++ level for anti-fingerprint resistance — for sites that
  block conventional headless browsers (Cloudflare, DataDome, PerimeterX,
  Turnstile, Google's bot wall, LinkedIn, etc.). The stable fingerprint is
  pinned once and reused, so you don't present a different device on every
  launch.

## Quick start

```bash
# 1. (optional) Pre-warm the shared camofox-browser server (VNC on).
#    Skip this — the extension auto-starts it on first camofox_* call if
#    it's a local server and not already up.
./deploy/start-camofox-browser.sh
#    API:  http://localhost:9377   ·   live view: http://localhost:6080/vnc.html

# 2. Install this extension into Pi
pi install -l .            # project-local (this checkout)
#   or:  pi install npm:ghostfox          (once published)
#   or:  pi install git:github.com/whispers-from-space/GhostFox

# 3. Reload Pi, then just ask — the LLM calls the camofox_* tools itself
/reload
```

## Everyday commands

```bash
./deploy/start-camofox-browser.sh                         # start server (VNC on)
pkill -f "camofox-browser[.]js"                           # stop server
./deploy/wake-browser.sh [--profile <name>] [url]         # wake browser after idle shutdown
curl http://localhost:9377/health                         # server health
curl http://localhost:9377/vnc/status                     # VNC state
tail -f /tmp/camofox-browser.log                          # server log
```

## Tools this extension exposes

`camofox_open` · `camofox_list_tabs` · `camofox_close_tab` · `camofox_snapshot`
· `camofox_click` · `camofox_type` · `camofox_navigate` · `camofox_screenshot`
· `camofox_tab_stats`

(The LLM calls these automatically — no slash command needed.)

## Bundled skills

Discovered via the `resources_discover` event — invoked as `/skill:<name>`:

- **`camofox-browser`** — usage guidance for the `camofox_*` tools (auto-invoked when you use the tools; no slash command needed).
- **`ask-chatgpt`** / **`ask-claude`** / **`ask-gemini`** — relay a question to that assistant's web UI via a shared logged-in camofox profile and return its exact response. Use only when the user explicitly wants that assistant's answer (`/skill:ask-chatgpt`, etc.).

## Where to look for more

| If you want to… | Open |
|---|---|
| Install / upgrade the extension, set `CAMOFOX_URL` / `CAMOFOX_API_KEY` | [docs/setup.md](docs/setup.md) |
| Know what each tool does and see usage examples | [docs/tools.md](docs/tools.md) |
| Configure profiles / URL→profile mapping / log a profile into a site | [docs/profiles.md](docs/profiles.md) |
| Understand sessions, BrowserContexts, the single VNC display | [docs/architecture.md](docs/architecture.md) |
| Find where state lives on disk (and what's git-ignored) | [docs/data.md](docs/data.md) |
| Start / stop / wake / configure / debug the server | [docs/server.md](docs/server.md) |
| Debug a broken VNC after an npm upgrade, or the launcher's self-healing patches | [docs/server-internals.md](docs/server-internals.md) |
| Troubleshoot / verify endpoints against your instance | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Fork / rename / publish this package | [docs/contributing.md](docs/contributing.md) |

Full pointer list with one-line summaries: [docs/INDEX.md](docs/INDEX.md).

## License

MIT — see [LICENSE](LICENSE).
