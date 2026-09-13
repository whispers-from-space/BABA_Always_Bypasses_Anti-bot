# GhostFox

A [Pi](https://pi.dev) extension that wraps [camofox-browser](https://github.com/jo-inc/camofox-browser)'s
REST API as Pi tools, with profile-based session persistence and a VNC
manual-login path for sites that need a human to click through auth once.

This README is a quick command manual. **The real documentation lives in
[`docs/`](docs/) — open [`docs/INDEX.md`](docs/INDEX.md) to find the right
file for what you're doing.** Don't read everything; pick by task.

## Quick start

```bash
# 1. Start the shared camofox-browser server (VNC on by default)
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
