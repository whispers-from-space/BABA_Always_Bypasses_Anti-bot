---
title: Server (start / wake / configure / debug)
summary: Open this when you are starting, stopping, or waking the camofox-browser server, overriding its config env vars, or running the day-to-day health/log/debug curl commands.
---

# Server: start / wake / configure / debug

This covers operating the shared camofox-browser server. For the *why*
behind the single browser / single VNC display, see
[architecture.md](architecture.md); for the launcher's self-healing patches
and user-space VNC dependencies, see [server-internals.md](server-internals.md).

## Starting the server (VNC default-on)

```bash
./deploy/start-camofox-browser.sh   # VNC on, API on :9377, viewer on :6080
```

The launcher starts the one shared camofox-browser instance (from the npx
cache) detached, with stdout/stderr to `/tmp/camofox-browser.log`. VNC is
**ON by default** — open `http://localhost:6080/vnc.html` any time to watch
the browser live (x11vnc on `:5900`, noVNC web UI on `:6080`, both bound to
127.0.0.1 only).

- **stop**: `pkill -f "camofox-browser[.]js"`; **restart** = stop + run the script again
- **status**: `curl http://localhost:9377/health` (server) and
  `curl http://localhost:9377/vnc/status` (VNC state: enabled/running/display)
- **wake**: `./deploy/wake-browser.sh [--profile <name>] [url]` — see below

## Waking the browser after idle shutdown (`wake-browser.sh`)

Only the *browser* (plus its Xvfb display and x11vnc) idle-shutdowns — the
server process and the noVNC web UI keep running, but the viewer shows
black/`Failed to connect to downstream server` until a browser exists again.
The idle timers (`TAB_INACTIVITY_MS`, `SESSION_TIMEOUT_MS`,
`BROWSER_IDLE_TIMEOUT_MS`, all defaulted to 1 h by the launcher) count
**API activity only** — mouse/keyboard inside noVNC do not refresh them, so a
long purely-manual session can still be reaped.

```bash
./deploy/wake-browser.sh                          # profile "default" (auto-created)
./deploy/wake-browser.sh --profile claude https://claude.ai
```

If the browser is already awake it just pokes a tab (refreshes the timers);
if it was idle-shutdown, creating the tab relaunches browser + display + VNC.

The wake tab belongs to a **real pi profile** (default name from
`defaultProfile` in `~/.pi/agent/camoufox-harness.json`, falling back to
`default`; auto-created in `<extension>/.camofox/pi-profiles.json` with the
same `pi-<name>-<hex>` scheme the extension uses). Persistence is per userId
and does not care whether clicks come from noVNC or the API — so a manual
login done on the wake tab is reusable from the extension via
`camofox_open(profile: "default")` with no extra steps. (The wake script
groups its tab under `sessionKey:"wake"` rather than `listItemId`, but the
persistence bucket is the same `userId` — see [architecture.md](architecture.md).)

## Configuration (user-facing)

All tunables are the env block at the top of `deploy/start-camofox-browser.sh`
and can be overridden per-run:

```bash
VNC_PASSWORD=secret NOVNC_PORT=8080 ./deploy/start-camofox-browser.sh
```

| Env var | Default | Meaning |
|---|---|---|
| `CAMOFOX_DATA_DIR` | `<extension>/.camofox` | root of all camofox state (see [data.md](data.md)) |
| `CAMOFOX_PROFILE_DIR` / `CAMOFOX_COOKIES_DIR` / `CAMOFOX_TRACES_DIR` | `<data dir>/profiles` etc. | server storage subdirs |
| `CAMOFOX_STABLE_FINGERPRINT_PATH` | `<data dir>/stable-fingerprint.json` | where vnc-fit persists the stable device fingerprint |
| `CAMOFOX_PORT` | `9377` | REST API port |
| `ENABLE_VNC` | `1` | `1` = VNC on |
| `VNC_PASSWORD` | *(empty)* | set to require a password in the viewer |
| `VNC_PORT` | `5900` | x11vnc port |
| `NOVNC_PORT` | `6080` | noVNC web viewer port |
| `VNC_BIND` | `127.0.0.1` | bind address (keep localhost unless you WANT exposure) |
| `VNC_RESOLUTION` | `1706x1067` | virtual display size (= 2560x1600 physical at 150% Windows scaling, so noVNC fits 1:1; adjust per monitor) |
| `VIEW_ONLY` | `0` | `1` = view-only, no mouse/keyboard input |
| `NOVNC_DIR` | `~/.local/share/novnc` | noVNC web files (user-space install) |
| `LOG_FILE` | `/tmp/camofox-browser.log` | server stdout/stderr |
| `CAMOFOX_PKG_BIN` | npx-cache path | where the `@askjo/camofox-browser` server lives |
| `SESSION_TIMEOUT_MS` | `3600000` | session idle timeout (1 h; manual VNC input doesn't refresh it) |
| `TAB_INACTIVITY_MS` | `3600000` | per-tab idle reaper (1 h) |
| `BROWSER_IDLE_TIMEOUT_MS` | `3600000` | browser idle shutdown (1 h) |
| `PIN_PLAYWRIGHT_CORE_VERSION` | `1.58.0` | playwright-core pin, re-applied on every start (see [server-internals.md](server-internals.md)) |
| `CAMOFOX_STABLE_FINGERPRINT` | `1` | `0` = re-roll device fingerprint on every browser launch (upstream behaviour) |

## Operation / debugging

```bash
curl http://localhost:9377/health            # JSON health
curl http://localhost:9377/vnc/status        # VNC state (enabled/running/display)
curl http://localhost:9377/openapi.json      # OpenAPI spec
open http://localhost:9377/docs              # interactive API docs
open http://localhost:6080/vnc.html          # live VNC view (default ON)
tail -f /tmp/camofox-browser.log             # structured one-JSON-object-per-line log
```
