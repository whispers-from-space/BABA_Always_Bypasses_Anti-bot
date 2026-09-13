/**
 * vnc-fit plugin -- Camoufox window/screen fit + stable identity for noVNC use.
 *
 * Problem 1 (geometry): Camoufox generates a RANDOM device fingerprint per
 * launch (browserforge pool), including the screen size, and the fork sizes
 * the REAL browser window to that spoofed screen. When the window is bigger
 * than the Xvfb screen (VNC_RESOLUTION) -- or positioned outside it -- noVNC
 * shows only the top-left corner of the window, or black.
 *
 * Problem 2 (identity churn): the per-launch fingerprint re-roll also means
 * every browser restart looks like a DIFFERENT device. Sites that bind login
 * sessions to device signals (Google/Anthropic-class) then treat restored
 * cookies as "stolen session / new device" and demand re-login. For a
 * single-user assistant browser a STABLE identity is both more human-like and
 * keeps logins across restarts.
 *
 * What this plugin does on `browser:launching` (rewrites CAMOU_CONFIG_1, the
 * JSON the fork reads for stealth values):
 *   1. Stable identity (default ON, CAMOFOX_STABLE_FINGERPRINT=0 to disable):
 *      first launch saves the generated fingerprint to
 *      $CAMOFOX_STABLE_FINGERPRINT_PATH (default ~/.camofox/stable-fingerprint.json;
 *      this deployment points it at <extension>/.camofox/); later launches
 *      reuse it, so the device identity survives browser restarts.
 *      Auto-invalidated when the installed Camoufox browser version changes
 *      (UA must match the binary).
 *   2. Geometry pin: screen.width/height = VNC_RESOLUTION and the window
 *      (outerWidth/outerHeight + screenX/screenY) centered fully inside it,
 *      so the whole browser window is always visible in noVNC.
 *
 * Everything else in the fingerprint (UA, fonts, WebGL, ...) is left as
 * generated (or as saved). Installed by deploy/start-camofox-browser.sh into
 * the package's plugins/ dir on every start (survives reinstalls).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARGIN_X = 26; // side margin between window and screen edge
const MARGIN_Y = 8;  // top+bottom margin (window titlebar eats ~32 of this)

const STORE_PATH =
  process.env.CAMOFOX_STABLE_FINGERPRINT_PATH ||
  path.join(os.homedir(), '.camofox', 'stable-fingerprint.json');

function parseResolution(raw) {
  const m = String(raw || '').match(/^(\d+)x(\d+)/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

function readCamoufoxVersion() {
  try {
    const v = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.cache', 'camoufox', 'version.json'), 'utf8')
    );
    return v.release ? `${v.version}-${v.release}` : String(v.version);
  } catch {
    return null;
  }
}

function applyGeometry(cfg, res) {
  const outerW = res.width - MARGIN_X;
  const outerH = res.height - MARGIN_Y;
  cfg['screen.width'] = res.width;
  cfg['screen.height'] = res.height;
  cfg['screen.availWidth'] = res.width;
  cfg['screen.availHeight'] = Math.max(res.height - 40, 0);
  cfg['screen.availLeft'] = 0;
  cfg['screen.availTop'] = 0;
  cfg['window.outerWidth'] = outerW;
  cfg['window.outerHeight'] = outerH;
  cfg['window.screenX'] = Math.max(Math.floor((res.width - outerW) / 2), 0);
  cfg['window.screenY'] = Math.max(Math.floor((res.height - outerH) / 2), 0);
  return cfg;
}

export async function register(app, ctx, pluginConfig = {}) {
  const { events, log } = ctx;
  const stable = process.env.CAMOFOX_STABLE_FINGERPRINT !== '0';

  events.on('browser:launching', ({ options }) => {
    const env = options?.env;
    const raw = env && env.CAMOU_CONFIG_1;
    if (!raw) return;

    try {
      let cfg = JSON.parse(raw);
      const version = readCamoufoxVersion();
      let reused = false;

      if (stable) {
        try {
          const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
          if (store?.config && store?.camoufoxVersion && store.camoufoxVersion === version) {
            cfg = store.config;
            reused = true;
          }
        } catch {
          /* no store yet or unreadable -- fall through to save */
        }
      }

      const res = parseResolution(process.env.VNC_RESOLUTION);
      if (res) applyGeometry(cfg, res);

      env.CAMOU_CONFIG_1 = JSON.stringify(cfg);

      if (stable && !reused && version) {
        fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
        fs.writeFileSync(
          STORE_PATH,
          JSON.stringify({ camoufoxVersion: version, config: cfg }, null, 2)
        );
        log('info', 'vnc-fit: saved stable fingerprint', { version, path: STORE_PATH });
      } else if (reused) {
        log('info', 'vnc-fit: reusing stable fingerprint', { version });
      }
      if (res) {
        log('info', 'vnc-fit: pinned fingerprint geometry', {
          screen: `${res.width}x${res.height}`,
          outer: `${res.width - MARGIN_X}x${res.height - MARGIN_Y}`,
        });
      }
    } catch (err) {
      log('error', 'vnc-fit: failed to patch CAMOU_CONFIG_1', { error: err.message });
    }
  });

  log('info', 'vnc-fit plugin registered', { stable });
}
