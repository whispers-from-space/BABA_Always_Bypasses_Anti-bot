#!/usr/bin/env bash
#
# Wake the camofox browser (and with it Xvfb + x11vnc + noVNC) after an idle
# shutdown, by touching or creating a tab in a session. Safe to run any time:
#   - server not running        -> tells you to run start-camofox-browser.sh
#   - browser already awake     -> just pokes a tab (refreshes idle timers)
#   - browser idle-shutdown     -> creating the tab relaunches it; the VNC
#                                  watcher reattaches x11vnc automatically
#
# Usage:
#   ./deploy/wake-browser.sh                      # profile "default"
#   ./deploy/wake-browser.sh --profile <name>     # any pi profile (auto-created)
#   ./deploy/wake-browser.sh [url]                # open url instead of example.com
#
# Persistence model: cookies/login state live per userId (browser context).
# Manual noVNC clicks and API clicks on the same tab are identical to the
# server -- both persist under that tab's userId. So this script wakes the
# browser under a REAL pi profile, auto-created in <extension>/.camofox/
# pi-profiles.json with the same scheme the pi extension uses. The default
# profile name comes from ~/.pi/agent/camoufox-harness.json (defaultProfile,
# else "default") -- the same resolution camofox_open uses when called
# without an explicit profile. A manual login done on the wake tab is
# therefore reusable from the extension with no extra steps, no per-site
# arguments.
set -euo pipefail

CAMOFOX_PORT="${CAMOFOX_PORT:-9377}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
EXT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILES_PATH="${PROFILES_PATH:-${CAMOFOX_DATA_DIR:-${EXT_ROOT}/.camofox}/pi-profiles.json}"
HARNESS_CONFIG="${HARNESS_CONFIG:-${HOME}/.pi/agent/camoufox-harness.json}"
PROFILE="${WAKE_PROFILE:-}"
URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a name}"; shift 2 ;;
    *) URL="$1"; shift ;;
  esac
done

# No explicit profile: use the config's defaultProfile (same as the extension).
if [ -z "$PROFILE" ]; then
  PROFILE="$(CONFIG_PATH="$HARNESS_CONFIG" node -e '
    let c = {};
    try { c = JSON.parse(require("fs").readFileSync(process.env.CONFIG_PATH, "utf8")); } catch {}
    process.stdout.write(String(c.defaultProfile || "default"));
  ')"
fi
URL="${URL:-https://example.com/}"
BASE="http://localhost:${CAMOFOX_PORT}"

# Resolve (or create, like the extension's resolveUserId) the profile userId.
USER_ID="$(PROFILE="$PROFILE" PROFILES_PATH="$PROFILES_PATH" node -e '
  const fs = require("fs"), path = require("path"), { randomUUID } = require("crypto");
  const p = process.env.PROFILES_PATH, name = process.env.PROFILE;
  let m = {}; try { m = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
  if (!m[name]) {
    m[name] = `pi-${name}-${randomUUID().slice(0, 8)}`;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
  }
  process.stdout.write(m[name]);
')"

if ! curl -fsS -m 3 "${BASE}/health" >/dev/null 2>&1; then
  echo "camofox-browser server is not running; start it first:" >&2
  echo "  ./deploy/start-camofox-browser.sh" >&2
  exit 1
fi

TAB_ID="$(curl -fsS "${BASE}/tabs?userId=${USER_ID}" | node -e '
  let d = ""; process.stdin.on("data", c => d += c);
  process.stdin.on("end", () => {
    const t = JSON.parse(d).tabs || [];
    process.stdout.write(t.length ? t[0].tabId : "");
  });
')"

if [ -n "$TAB_ID" ]; then
  # Poke an existing tab -- refreshes session/tab idle timers.
  curl -fsS -X POST "${BASE}/tabs/${TAB_ID}/evaluate" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"${USER_ID}\",\"expression\":\"1\"}" >/dev/null
  echo "browser already awake; timers refreshed (profile '${PROFILE}', userId ${USER_ID})"
else
  # No session/tab -- creating one relaunches the browser + display + VNC.
  curl -fsS -X POST "${BASE}/tabs" \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"${USER_ID}\",\"sessionKey\":\"wake\",\"url\":\"${URL}\"}" >/dev/null
  echo "browser relaunched (profile '${PROFILE}', userId ${USER_ID})"
fi

echo "VNC view: http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=scale"
echo "manual logins on this tab persist to profile '${PROFILE}' (camofox_open(profile: \"${PROFILE}\") reuses them)"
