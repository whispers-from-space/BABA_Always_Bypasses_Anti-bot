#!/usr/bin/env bash
#
# Start the shared camofox-browser server (VNC visual display ON by default).
#
# The camofox-browser server has no per-session display toggle -- visibility is
# decided at process start (ENABLE_VNC=1) plus the VNC plugin's deps:
#   * x11vnc     -> user-space install (~/.local/x11vnc + ~/.local/bin/x11vnc shim)
#   * websockify -> pip --user (~/.local/bin/websockify)
#   * noVNC web  -> ~/.local/share/novnc (watcher pointed at it via NOVNC_DIR)
# Watch the live browser at: http://localhost:6080/vnc.html
#
# Usage:  ./deploy/start-camofox-browser.sh
set -euo pipefail

# ── user-facing configuration ────────────────────────────────────────────
# Edit these (or override on the command line: VNC_PASSWORD=secret ./deploy/start-camofox-browser.sh)
export CAMOFOX_PORT="${CAMOFOX_PORT:-9377}"                  # REST API port
export CAMOFOX_CRASH_REPORT_ENABLED="${CAMOFOX_CRASH_REPORT_ENABLED:-false}"
export ENABLE_VNC="${ENABLE_VNC:-1}"                        # 1 = VNC on
export VNC_BIND="${VNC_BIND:-127.0.0.1}"                    # bind address (keep 127.0.0.1 unless you WANT exposure)
export VNC_PASSWORD="${VNC_PASSWORD:-}"                     # set to require a password in the viewer
export VNC_PORT="${VNC_PORT:-5900}"                        # x11vnc port
export NOVNC_PORT="${NOVNC_PORT:-6080}"                    # noVNC web viewer port
#
# VNC_RESOLUTION = the virtual desktop (Xvfb screen) the browser runs on.
#
#   Your physical screen is 2560x1600 at 150% Windows scaling, so the browser
#   window's usable CSS area is ~2560/1.5 x 1600/1.5 = 1706x1067 px. noVNC's
#   default "Scaling mode = No scaling" renders the framebuffer 1:1 and clips
#   to the window: a 1920x1080 framebuffer was therefore "zoomed into the
#   top-left corner" on your screen. Setting the framebuffer to the same size
#   as your viewport makes the whole desktop visible at crisp 1:1 pixels.
#
#   If you change screens / scaling, just update this value (or switch noVNC
#   "Scaling mode" to "Local scaling" in its gear panel -- persisted in the
#   browser, fits the framebuffer to any window).
#
export VNC_RESOLUTION="${VNC_RESOLUTION:-1706x1067}"        # virtual display size
export VIEW_ONLY="${VIEW_ONLY:-0}"                         # 1 = view-only (no mouse/keyboard)
# Manual noVNC interaction (mouse/keyboard inside the viewer) never hits the
# REST API, so it doesn't refresh the server's idle reapers. Default 10 min
# would kill the browser mid-session while you work in the viewer -- give
# interactive VNC use an hour.
export SESSION_TIMEOUT_MS="${SESSION_TIMEOUT_MS:-3600000}"
export BROWSER_IDLE_TIMEOUT_MS="${BROWSER_IDLE_TIMEOUT_MS:-3600000}"
export TAB_INACTIVITY_MS="${TAB_INACTIVITY_MS:-3600000}"
export NOVNC_DIR="${NOVNC_DIR:-${HOME}/.local/share/novnc}" # noVNC web files (user-space install)
#
# ── data directory ────────────────────────────────────────────────────────
# All camofox state lives in <extension>/.camofox (this repo, git-ignored),
# NOT ~/.camofox: browser profiles, cookies, traces, pi's profile map
# (pi-profiles.json) and the vnc-fit stable fingerprint. Moving the checkout
# moves every bit of login state with it.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export CAMOFOX_DATA_DIR="${CAMOFOX_DATA_DIR:-$(dirname "$SCRIPT_DIR")/.camofox}"
export CAMOFOX_COOKIES_DIR="${CAMOFOX_COOKIES_DIR:-${CAMOFOX_DATA_DIR}/cookies}"
export CAMOFOX_PROFILE_DIR="${CAMOFOX_PROFILE_DIR:-${CAMOFOX_DATA_DIR}/profiles}"
export CAMOFOX_TRACES_DIR="${CAMOFOX_TRACES_DIR:-${CAMOFOX_DATA_DIR}/traces}"
# vnc-fit persists its stable device fingerprint under the same data dir.
export CAMOFOX_STABLE_FINGERPRINT_PATH="${CAMOFOX_STABLE_FINGERPRINT_PATH:-${CAMOFOX_DATA_DIR}/stable-fingerprint.json}"
#
# playwright-core compatibility pin.
#   camofox-browser 1.13.x declares "playwright-core": "^1.58.0", which lets npm
#   hoist 1.61+. Since 1.61.0, the Firefox driver sends "isMobile"/"screenSize"
#   inside Browser.setDefaultViewport -- fields the Camoufox protocol schema
#   does not describe. The server's health probe calls browser.newContext()
#   (which sets a default viewport), so EVERY probe fails, the browser is
#   force-restarted every ~3 minutes, and Xvfb + x11vnc die each time ->
#   noVNC shows black/empty screens. 1.58.0 sends only viewportSize +
#   deviceScaleFactor and keeps the health probe happy. This script re-pins
#   the version on every start so a future npm/npx reinstall can't silently
#   reintroduce the bug.
export PIN_PLAYWRIGHT_CORE_VERSION="${PIN_PLAYWRIGHT_CORE_VERSION:-1.58.0}"
LOG_FILE="${LOG_FILE:-/tmp/camofox-browser.log}"

# ── helpers ──────────────────────────────────────────────────────────────

# Locate camofox-browser's bin -- newest version wins across npx caches,
# so re-installs don't hard-break this script. CAMOFOX_PKG_BIN still overrides.
find_pkg_bin() {
  node -e '
    const fs = require("fs"), path = require("path");
    const base = path.join(process.env.HOME, ".npm", "_npx");
    let best = "", bestVer = "0.0.0";
    if (fs.existsSync(base)) {
      for (const dir of fs.readdirSync(base)) {
        const p = path.join(base, dir, "node_modules", "@askjo", "camofox-browser", "package.json");
        if (!fs.existsSync(p)) continue;
        const ver = JSON.parse(fs.readFileSync(p, "utf8")).version;
        const pa = ver.split(".").map(Number), pb = bestVer.split(".").map(Number);
        let cmp = 0;
        for (let i = 0; i < 3; i++) { if ((pa[i]||0) !== (pb[i]||0)) { cmp = (pa[i]||0) - (pb[i]||0); break; } }
        if (cmp > 0) { best = path.join(path.dirname(p), "bin", "camofox-browser.js"); bestVer = ver; }
      }
    }
    process.stdout.write(best);
  '
}

# Pin playwright-core in the npx install tree (see PIN_PLAYWRIGHT_CORE_VERSION).
pin_playwright_core() {
  local pkg_bin="$1" npx_root pwc_pkg pwc
  npx_root="$(dirname "$(dirname "$(dirname "$(dirname "$pkg_bin")")")")"
  pwc_pkg="${npx_root}/node_modules/playwright-core/package.json"
  [ -f "$pwc_pkg" ] || return 0
  pwc="$(node -e "console.log(require('$pwc_pkg').version)" 2>/dev/null || true)"
  [ -n "$pwc" ] || return 0
  if [ "$pwc" != "$PIN_PLAYWRIGHT_CORE_VERSION" ]; then
    echo "pinning playwright-core $pwc -> $PIN_PLAYWRIGHT_CORE_VERSION (1.61+ breaks Camoufox health probe -> browser restart loop)"
    (cd "$npx_root" && npm install "playwright-core@${PIN_PLAYWRIGHT_CORE_VERSION}" --no-save --no-audit --no-fund --loglevel=error) >/dev/null 2>&1 || {
      echo "WARNING: could not pin playwright-core (network?); health-probe restart loop may return" >&2
    }
    pwc="$(node -e "console.log(require('$pwc_pkg').version)" 2>/dev/null || true)"
    echo "  installed playwright-core: ${pwc:-unknown}"
  fi
}

# Xvfb lock files accumulate when the browser is force-killed (every restart
# leaks one into /tmp). Remove locks whose PID is no longer alive so display
# numbers get reused instead of climbing forever.
cleanup_stale_xvfb_locks() {
  for lock in /tmp/.X[0-9][0-9]*-lock; do
    [ -f "$lock" ] || continue
    pid="$(tr -d '[:space:]' < "$lock" 2>/dev/null || true)"
    case "$pid" in ''|*[!0-9]*) rm -f "$lock"; continue ;; esac
    kill -0 "$pid" 2>/dev/null || rm -f "$lock"
  done
}

# vnc-fit plugin: Camoufox sizes its REAL window to a random per-launch
# fingerprint screen (browserforge pool) -- often 2560x1440+ -- which overflows
# the Xvfb screen and makes noVNC show only the top-left corner (or black).
# This installs a tiny plugin into the camofox-browser package that rewrites
# the fingerprint's screen/window geometry to VNC_RESOLUTION on every launch,
# so the window always fits the virtual display. Regenerated on each start so
# package reinstalls can't silently drop it.
install_vnc_fit_plugin() {
  local pkg_dir plugins_dir src_dir cfg_path
  pkg_dir="$(dirname "$1")/.."                 # <npx>/node_modules/@askjo/camofox-browser
  plugins_dir="${pkg_dir}/plugins"
  cfg_path="${pkg_dir}/camofox.config.json"
  src_dir="${CAMOFOX_VNC_FIT_SRC:-$(cd "$(dirname "$0")" && pwd)/camofox-vnc-fit}"
  mkdir -p "${plugins_dir}/vnc-fit"
  if [ -d "$src_dir" ]; then
    cp "$src_dir"/index.js "$src_dir"/plugin.json "${plugins_dir}/vnc-fit/" 2>/dev/null || {
      echo "WARNING: could not install vnc-fit plugin from $src_dir" >&2
    }
  fi
  # Register the plugin in the package's plugin allowlist (config.pluginEnv only
  # forwards ENABLE_VNC, so enableEnvVar alone is not enough).
  if [ -f "$cfg_path" ]; then
    node -e "
      const fs = require('fs');
      const p = '$cfg_path';
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      c.plugins = c.plugins || {};
      if (!c.plugins['vnc-fit']) c.plugins['vnc-fit'] = { enabled: true };
      fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
    "
  fi
  export VNC_FIT="${VNC_FIT:-1}"   # plugin.json enableEnvVar; enables the plugin
}

# ── startup ──────────────────────────────────────────────────────────────

PKG_BIN="${CAMOFOX_PKG_BIN:-$(find_pkg_bin)}"

if [ ! -f "$PKG_BIN" ]; then
  echo "camofox-browser package not found; set CAMOFOX_PKG_BIN or run: npx -y @askjo/camofox-browser@1.13.0" >&2
  exit 1
fi

cd "${CAMOFOX_CWD:-$(dirname "$SCRIPT_DIR")}"   # repo root by default

if pgrep -f "node .*camofox-browser[.]js" >/dev/null 2>&1; then
  echo "camofox-browser already running; stop it first (pkill -f 'camofox-browser[.]js')" >&2
  exit 1
fi

pin_playwright_core "$PKG_BIN"
install_vnc_fit_plugin "$PKG_BIN"
cleanup_stale_xvfb_locks
mkdir -p "$CAMOFOX_DATA_DIR"

# websockify daemonizes and survives server restarts, holding $NOVNC_PORT so
# the new watcher's websockify fails to bind ("Address already in use").
# Kill strays so the new watcher owns the port.
pkill -f "websockify .*:${NOVNC_PORT} " 2>/dev/null || true
sleep 0.5

nohup node "$PKG_BIN" >>"$LOG_FILE" 2>&1 &
echo "camofox-browser started (pid $!)"
echo "  API:      http://localhost:${CAMOFOX_PORT}  (/health, /openapi.json)"
echo "  Data:     ${CAMOFOX_DATA_DIR} (profiles, cookies, traces, stable fingerprint)"
echo "  VNC view: http://localhost:${NOVNC_PORT}/vnc.html  (password: ${VNC_PASSWORD:+set}${VNC_PASSWORD:-none})"
echo "  Display:  ${VNC_RESOLUTION} virtual desktop; noVNC default scaling = 'No scaling' (use 'Local scaling' in gear panel if window size changes)"
echo "  Log:      ${LOG_FILE}"
