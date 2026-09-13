# GhostFox

A [Pi](https://pi.dev) extension over the [Camoufox](https://github.com/jo-inc/camofox-browser)
anti-fingerprint browser.

**The headline: the agent writes fixed-step web workflows down as
self-healing skills it maintains and fixes itself — so each repeat costs one
bash call, not a fresh round of LLM tokens re-driving the browser.** Log in
by hand once and the agent reuses that session forever; watch it browse live
to debug it.

```bash
pi install npm:ghostfox
```

## Self-healing workflow skills

A fixed-step web workflow (log in, click through a few pages, scrape a table,
post a reply) should NOT be re-driven with LLM tokens every time. The agent
writes it down as a **skill** — a `SKILL.md` plus a code script that drives
the browser — and then **maintains and fixes it itself**, so repeat runs cost
one bash call instead of a fresh round of exploration.

- **First run:** the agent does the workflow interactively — `camofox_open`,
  snapshot the page, click, type, navigate — and captures those steps as a
  runnable Node script using stable CSS selectors (not ephemeral refs). A
  `SKILL.md` next to it makes the workflow invocable as `/skill:<name>`.
- **Every run after:** one bash call runs the script. No re-exploration, no
  re-snapshotting, no tokens spent re-deriving what the agent already knows.
  A 15-step workflow costs full LLM attention once, then one bash call forever.
- **When the site changes and the script breaks:** the agent doesn't redo the
  whole workflow. It re-snapshots just the broken step, finds the new
  selector, and patches its own script — the fix persists for next time.

The net effect: **repeat web operations stop burning tokens.** The bundled
`ask-chatgpt` / `ask-claude` / `ask-gemini` skills are three shipped examples
of exactly this pattern.

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

- **Bundled example skills.** `ask-chatgpt`, `ask-claude`, and `ask-gemini`
  ship as worked examples of the fixed-workflow-skill pattern above — each is
  a `SKILL.md` + a wrapped Node script that drives the camofox REST API via
  the same logged-in profile, relaying a question to that assistant's web UI
  and returning its exact response. Use them as templates for your own
  captured workflows (`/skill:ask-chatgpt`, etc.).

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
