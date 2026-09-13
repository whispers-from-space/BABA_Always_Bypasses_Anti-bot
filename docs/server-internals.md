---
title: Server internals (self-healing patches & VNC deps)
summary: Open this when an npm/npx upgrade broke VNC or the health probe, or when you want to understand the launcher's self-healing patches (the playwright-core pin and the vnc-fit plugin) and the user-space, no-root VNC dependencies.
---

# Server internals: self-healing patches & VNC dependencies

The launcher (`deploy/start-camofox-browser.sh`) re-applies two fixes to the
npx-cached `@askjo/camofox-browser` package each time it runs, so `npm`/npx
reinstalls or version upgrades can't silently drop them. It also cleans
stale `/tmp/.X*-lock` files (force-killed Xvfbs leak one per restart) and
kills stray `websockify` processes holding `NOVNC_PORT`.

For day-to-day server operation see [server.md](server.md); this file is the
deep "why does the launcher patch the cache" reference.

## 1. playwright-core pin (`PIN_PLAYWRIGHT_CORE_VERSION=1.58.0`)

camofox-browser declares `playwright-core: ^1.58.0`, which lets npm hoist
1.61+; since 1.61.0 the Firefox driver sends `isMobile`/`screenSize` in
`Browser.setDefaultViewport`, which Camoufox's protocol schema rejects —
the server's health probe then fails every cycle and force-restarts the
browser every ~3 minutes (killing Xvfb/x11vnc → black noVNC screens).
Pinning in the npx cache's own `package.json` would work *until npx
recreates that cache* (it's npx bookkeeping, keyed per invocation — an
upgrade creates a fresh tree); re-asserting the pin at every start covers
all cases. (Alternative: declare the dep with an `overrides` entry in this
repo's `package.json` and run the server from project `node_modules` —
rejected so far because that pulls camoufox-js's native `better-sqlite3`
build into the project.)

The launcher runs `npm install playwright-core@<pin> --no-save` inside the
npx tree on every start (only when the installed version differs).

## 2. `vnc-fit` plugin (`deploy/camofox-vnc-fit/`)

Not an upstream upgrade — a small plugin written for this repo, installed
into the package's `plugins/` dir and registered in its `camofox.config.json`
on every start. It uses the package's official plugin API
(`browser:launching` hook) to rewrite the generated fingerprint
(`CAMOU_CONFIG_1`) in two ways:

- **geometry**: Camoufox otherwise sizes its real window to a random
  per-launch fingerprint screen (browserforge pool, e.g. 2560x1440) which
  overflows the Xvfb screen and made noVNC show only the top-left corner.
  The plugin pins `screen` = `VNC_RESOLUTION` and centers a window that
  fits inside it.
- **stable identity** (default ON, `CAMOFOX_STABLE_FINGERPRINT=0` to
  disable): Camoufox re-rolls its whole device fingerprint on every
  browser launch, so sites that bind sessions to device signals treated
  every restart as a new device and dropped restored logins. The plugin
  saves the first generated fingerprint to
  `<extension>/.camofox/stable-fingerprint.json` (via
  `CAMOFOX_STABLE_FINGERPRINT_PATH`) and reuses it on later launches
  (auto-invalidated when the installed Camoufox version changes, since the
  UA must match the binary). A stable single-device identity is also more
  human-like for a personal assistant browser.

## VNC dependencies (user-space, no root)

The VNC plugin needs `x11vnc`, `websockify` and the noVNC web files, none
of which were installed on this machine and no root was available, so they
live in user space:

| Component | Where | How it was installed |
|---|---|---|
| `x11vnc` | `~/.local/x11vnc/` + `~/.local/bin/x11vnc` shim (sets LD_LIBRARY_PATH) | `apt-get download` + `dpkg-deb -x` (Ubuntu noble) |
| `websockify` | `~/.local/bin/websockify` | `pip install --user --break-system-packages websockify` |
| noVNC web UI | `~/.local/share/novnc` | `git clone https://github.com/novnc/noVNC` |

Both `~/.local/bin` dirs are on the server's PATH, so the watcher's plain
`x11vnc` / `websockify` spawns resolve. The vendored watcher hardcodes
`/usr/share/novnc` (not writable without root), so small patches were made
in the npx-cached package:

- `plugins/vnc/vnc-watcher.sh`: `NOVNC_DIR="${NOVNC_DIR:-/usr/share/novnc}"`
- `plugins/vnc/vnc-launcher.js`: forward `NOVNC_DIR` in `buildWatcherEnv()`
- `plugins/vnc/vnc-watcher-lib.sh`: display resolution now handles **abstract
  X sockets** (this Camoufox's Xvfb exposes `@/tmp/.X11-unix/X<N>` in
  `/proc/net/unix` with no filesystem entry, which the stock watcher can't
  see, so x11vnc never attached)

The launcher passes `NOVNC_DIR=$HOME/.local/share/novnc`. All patches live in
the npx cache at
`~/.npm/_npx/512e2d3451475ec7/node_modules/@askjo/camofox-browser/` and are
lost on `npm` cache rebuild — re-apply after an upgrade (they're the same
2-3 lines; upstream would ideally take the NOVNC_DIR override + abstract-
socket fix).
