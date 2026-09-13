// ask-chatgpt.js
//
// Send a message to ChatGPT (chatgpt.com) via the shared camofox-browser
// server and print its response. Shares the exact logged-in session that
// interactive camofox_open uses -- profile is resolved from
// ~/.pi/agent/camoufox-harness.json (chatgpt.com -> "gmail") and the userId
// from .camofox/pi-profiles.json, via lib/camofox-client.js.
//
// Run: node ask-chatgpt.js "your message here"
// Requires Node 18+ (built-in fetch). No dependencies.

const fs = require("fs");
const path = require("path");
const {
  resolveProfileForUrl,
  resolveUserId,
  createClient,
  sleep,
  humanDelay,
} = require("../../lib/camofox-client");

const CHATGPT_URL = "https://chatgpt.com/";

// Profile + userId are resolved the same way camofox_open does, so this script
// reuses the interactive session (no separate login).
const PROFILE = resolveProfileForUrl(CHATGPT_URL); // -> "gmail"
const USER_ID = resolveUserId(PROFILE); // -> "pi-gmail-<hash>" (persisted)

// Persisted conversation URL so a restart/lazy-launch resumes the exact
// conversation by navigating to the stored /c/<id> URL.
const STATE_DIR = path.join(__dirname, ".state");
const CONVO_URL_FILE = path.join(STATE_DIR, "conversation-url.txt");

// Selectors confirmed against a live ChatGPT DOM snapshot (2026-08):
//  - The composer input is a ProseMirror contenteditable (NOT the hidden
//    <textarea name="prompt-textarea"> fallback, which fill() can't reach).
//  - The send button only becomes enabled once there is text in the editor.
//  - Assistant turns live in [data-message-author-role="assistant"].
const SELECTORS = {
  editor: "#prompt-textarea", // div.ProseMirror[contenteditable][role=textbox]
  sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
  assistantMessages: '[data-message-author-role="assistant"]',
  stopButton:
    'button[aria-label="Stop generating"], button[data-testid="composer-stop-button"], button[data-testid="stop-button"]',
};

// Generous ceilings. Completion detection is event-driven (MutationObserver
// inside the page), so these are hard ceilings, not polling cadences.
const TIMEOUTS = {
  editorReady: 30_000, // wait for composer to appear (page hydrated)
  newTurn: 45_000, // wait for a new assistant turn to start
  responseDone: 180_000, // wait for streaming to finish (event-driven)
};

class LoggedOutError extends Error {
  constructor() {
    super("risk control (logged_out)");
  }
}

function readPersistedUrl() {
  try {
    return fs.readFileSync(CONVO_URL_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}
function persistUrl(url) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(CONVO_URL_FILE, url);
  } catch (err) {
    console.error(`warn: could not persist conversation URL: ${err.message}`);
  }
}

// Wait for the composer editor to be present and visible (page hydrated).
async function waitForEditor(client, tabId) {
  const expr = `(() => {
    const el = document.querySelector('${SELECTORS.editor}');
    if (!el) return JSON.stringify({ ready: false });
    const r = el.getBoundingClientRect();
    const visible = !!(el.offsetWidth || el.offsetHeight) && r.width > 10;
    return JSON.stringify({ ready: visible, loggedOut: /\\/auth\\/login|auth0/i.test(location.href) });
  })()`;
  const deadline = Date.now() + TIMEOUTS.editorReady;
  while (Date.now() < deadline) {
    const raw = await client.evaluate(tabId, expr);
    let s = {};
    try {
      s = JSON.parse(raw);
    } catch {
      s = { ready: false };
    }
    if (s.loggedOut) throw new LoggedOutError();
    if (s.ready) return;
    await sleep(400);
  }
  throw new Error("editor did not become ready in time (page may not have hydrated)");
}

// Messages longer than this bypass /type: keyboard.type takes ~15ms/char
// (a 4KB prompt = ~60s of typing), and ChatGPT's constant re-renders make
// the page "change" mid-type, aborting /type with HTTP 409 page_changed --
// the only route that emits it. Long messages are inserted via /evaluate
// (execCommand) and sent with /press Enter instead; neither route does an
// actionability check, so neither can 409.
const TYPE_MAX_CHARS = 200;

async function send(client, tabId, message) {
  // Newlines are collapsed to spaces: keyboard.type presses Enter per "\n",
  // which would send prematurely (multi-line input is flattened either way).
  const single = message.replace(/\r?\n/g, " ");

  if (single.length <= TYPE_MAX_CHARS) {
    // Short message: human-like typing. Focus the ProseMirror editor directly
    // via JS -- this avoids the /click actionability check, which races with
    // ChatGPT's constant re-renders and fails with HTTP 409 on selector
    // clicks. Keyboard mode with no selector types into the current focus.
    await client.evaluate(
      tabId,
      `document.querySelector('${SELECTORS.editor}').focus()`
    );
    await humanDelay();
    await client.type(tabId, undefined, single, {
      mode: "keyboard",
      delay: 15,
      submit: true,
    });
    return;
  }

  // Long message: insert via /evaluate, verify, then /press Enter.
  // select-all + delete first so a stale composer draft (ChatGPT persists
  // them across navigations -- observed contaminating a reused tab) cannot
  // mix with the message. execCommand('insertText') first; the synthetic
  // ClipboardEvent paste is only a fallback -- it was observed once to
  // leave ~80 chars of unrelated garbage in the editor. NEVER press Enter
  // without verifying the editor holds ~the full text.
  const textJson = JSON.stringify(single);
  const minLen = Math.floor(single.length * 0.95);
  const insertExpr = `(() => {
    const ed = document.querySelector('${SELECTORS.editor}');
    if (!ed) return JSON.stringify({ ok: false, reason: 'no-editor' });
    ed.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('delete');
    let ok = false;
    try { ok = document.execCommand('insertText', false, ${textJson}); } catch (e) {}
    if (!ok) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', ${textJson});
        const pe = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        ed.dispatchEvent(pe);
      } catch (e) {}
    }
    const text = ed.innerText || ed.textContent || '';
    return JSON.stringify({ ok: text.trim().length >= ${minLen}, len: text.trim().length, expected: ${single.length} });
  })()`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let s = {};
    try {
      s = JSON.parse(await client.evaluate(tabId, insertExpr));
    } catch {
      s = { ok: false };
    }
    if (s.ok) break;
    if (attempt === 3) {
      throw new Error(`failed to insert full message into editor (len=${s.len}/${s.expected})`);
    }
    console.error(`insert attempt ${attempt} incomplete (len=${s.len}/${s.expected}), retrying`);
    await sleep(800);
  }
  await humanDelay();
  // Low-level Enter via /press -- no selector, no actionability, no 409 path.
  await client.press(tabId, "Enter");
}

// Wait for a new assistant turn to finish streaming -- event-driven, not
// polled. The whole wait is pushed into ONE page.evaluate whose returned
// Promise resolves on a MutationObserver firing inside the page. The server
// does `await page.evaluate(expr)`, and Playwright awaits a Promise the
// expression evaluates to, so this call blocks here with zero host-side
// polling: the resolution is driven by DOM mutations as tokens stream in.
//
// Completion signal (composite, ranked by reliability):
//   Primary   : the streaming class (`streaming-animation` on the .markdown
//               wrapper, with `result-streaming` as a legacy alias) is removed
//               from the new assistant message -- this is exactly what ChatGPT's
//               own frontend uses to stop the cursor animation, and its removal
//               fires the MutationObserver immediately (no dead time).
//   Confirm   : the stop button is NOT *visible* (offsetParent + computed
//               style), not merely absent. ChatGPT leaves a hidden stop-button
//               node lingering after completion, so presence-based gating
//               waits the full timeout; visibility-based gating does not.
//   Safety net: a short text-stability debounce (1 identical read) guards
//               against a single-frame mid-stream flicker where the streaming
//               class might momentarily drop. If the streaming-class selector
//               ever drifts (we never observe it), we fall back to pure text
//               stability (3 identical reads) so breakage fails open instead
//               of hanging to the ceiling.
//
// A new turn is detected by the last assistant message's data-message-id
// changing (robust to ChatGPT's conversation virtualization, which recycles
// DOM nodes and keeps the message count flat).
async function waitForResponse(client, tabId, beforeSig) {
  const expr = buildWaitExpression(beforeSig);
  const result = await client.evaluate(tabId, expr);
  // page.evaluate returns the resolved value directly (the final text).
  const text = typeof result === "string" ? result : "";
  if (!text) throw new Error("no response received from ChatGPT");
  return text;
}

// Build the in-page wait expression. Kept as a separate function so the big
// template literal is isolated from the rest of the module.
function buildWaitExpression(beforeSig) {
  const ASSISTANT = SELECTORS.assistantMessages;
  const STOP = SELECTORS.stopButton;
  const TURN_MS = TIMEOUTS.newTurn;
  const DONE_MS = TIMEOUTS.responseDone;
  const BEFORE = JSON.stringify(beforeSig || null);
  return String.raw`new Promise((resolve, reject) => {
  const ASSISTANT = ${JSON.stringify(ASSISTANT)};
  const STOP = ${JSON.stringify(STOP)};
  const BEFORE = ${BEFORE};
  const TURN_MS = ${TURN_MS};
  const DONE_MS = ${DONE_MS};

  let settled = false;
  const handles = [];
  const track = (h) => { handles.push(h); return h; };
  const cleanup = () => {
    for (const h of handles) {
      try { if (typeof h === 'number') { clearTimeout(h); clearInterval(h); }
            else if (h && typeof h.disconnect === 'function') h.disconnect(); } catch (e) {}
    }
  };
  const ok = (v) => { if (settled) return; settled = true; cleanup(); resolve(v); };
  const fail = (m) => { if (settled) return; settled = true; cleanup(); reject(new Error(m)); };

  track(setTimeout(() => fail('timeout waiting for ChatGPT response'), TURN_MS + DONE_MS + 5000));

  function lastAssistant() {
    const m = document.querySelectorAll(ASSISTANT);
    return m.length ? m[m.length - 1] : null;
  }
  // Visibility, not presence: ChatGPT leaves a hidden stop-button node mounted
  // after completion, so a presence check (btn != null) waits the full timeout.
  // offsetParent + computed style correctly reports a hidden lingering button
  // as not visible.
  function stopVisible() {
    const btn = document.querySelector(STOP);
    if (!btn) return false;
    const cs = getComputedStyle(btn);
    return btn.offsetParent !== null
      && cs.visibility !== 'hidden'
      && cs.display !== 'none'
      && btn.getAttribute('aria-hidden') !== 'true';
  }
  // Streaming is in progress if the message's markdown wrapper carries the
  // streaming class OR the (global) stop button is still visible. The current
  // build uses streaming-animation on the .markdown element; result-streaming
  // is kept as a legacy alias. Either signal is a valid per-turn streaming
  // indicator; combining both survives one selector drifting.
  function isStreaming(node) {
    if (!node) return false;
    if (node.querySelector('.streaming-animation, .result-streaming')) return true;
    return stopVisible();
  }
  function textOf(node) {
    if (!node) return '';
    const md = node.querySelector('.markdown') || node;
    return (md.innerText || node.innerText || '').trim();
  }

  // State for the current new turn. We DO NOT pin a DOM node: ChatGPT recycles
  // / re-creates the assistant message element (React key reuse), so a node
  // grabbed at turn-detection can become an orphaned shell with empty text --
  // which previously caused a full-timeout hang. Instead, every check re-queries
  // lastAssistant() and reads the live node.
  let sawNewTurn = false;
  let turnStartedAt = 0;
  let sawStreaming = false;
  let lastSig = null;
  let lastText = '';
  let stable = 0;

  function check() {
    if (settled) return;
    const node = lastAssistant();
    if (!node) return;
    const sig = node.getAttribute('data-message-id');
    // Ignore the pre-send last message; we only care about the new turn.
    if (!sig || sig === BEFORE) return;

    if (!sawNewTurn) { sawNewTurn = true; turnStartedAt = Date.now(); }
    // If the turn identity changed mid-watch (rare), reset stability tracking.
    if (sig !== lastSig) { lastSig = sig; lastText = ''; stable = 0; }

    const text = textOf(node);
    const streaming = isStreaming(node);
    if (streaming) sawStreaming = true;
    if (text && text === lastText) stable++; else stable = 0;
    lastText = text;

    // Primary: streaming class gone + stop hidden + non-empty + 1-frame debounce.
    // Fires essentially the instant ChatGPT removes streaming-animation, which
    // is the same signal its own frontend uses to stop the cursor animation.
    if (sawStreaming && !streaming && text.length > 0 && stable >= 1) {
      ok(text);
      return;
    }
    // Fallback: we never observed streaming active (ultra-fast response that
    // completed before the first check, OR both selectors drifted). Require the
    // stop button hidden + 3 identical reads so a mid-stream pause -- where the
    // stop button stays visible and streaming-animation stays put -- cannot
    // trigger a false positive. 3 reads at a 400ms cadence ~= 1.2s.
    if (!sawStreaming && !streaming && text.length > 0 && stable >= 3) {
      ok(text);
      return;
    }
    if (turnStartedAt && Date.now() - turnStartedAt > DONE_MS) {
      fail('timeout waiting for streaming to finish');
    }
  }

  // Observe the conversation root (not a single message node): token
  // insertions, the streaming-animation class add/remove, and any node
  // recycling all mutate this subtree, so check() fires on every chunk and the
  // moment streaming ends. check() re-queries the live last assistant each
  // time, so it follows ChatGPT's DOM recycling instead of watching an orphan.
  const root = document.querySelector('main') || document.body;
  const obs = new MutationObserver(check);
  obs.observe(root, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'data-streaming', 'aria-hidden', 'style'],
  });
  track(obs);
  // The stop button lives outside the watched subtree, so its
  // hide-after-completion won't trigger the observer. A light poll covers it
  // (and backs up the observer if mutations ever stop firing).
  track(setInterval(check, 400));
  check();
  // If no new turn appears at all, fail after the turn ceiling rather than the
  // full DONE_MS.
  track(setTimeout(() => { if (!sawNewTurn && !settled) fail('no response received from ChatGPT'); }, TURN_MS));
})`;
}

async function getMessage() {
  if (process.argv[2]) return process.argv[2];
  // Read from stdin if no arg given.
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
    // If stdin is a TTY (no piped input), reject with usage.
    if (process.stdin.isTTY) {
      console.error('Usage: node ask-chatgpt.js "your message"');
      process.exit(1);
    }
  });
}

async function main() {
  const message = await getMessage();
  if (!message) {
    console.error('Usage: node ask-chatgpt.js "your message"');
    process.exit(1);
  }

  const client = createClient(USER_ID);

  // 1. Reuse an existing tab for this profile if open, else create one.
  //    Navigate to the persisted conversation URL (or chatgpt.com) so a
  //    restart/lazy-launch resumes the exact conversation.
  const startUrl = readPersistedUrl() || CHATGPT_URL;
  const { tabId, created } = await client.getOrCreateTab(PROFILE, startUrl);
  console.error(`using tab ${tabId} (profile=${PROFILE}, created=${created})`);
  await client.navigate(tabId, startUrl);

  await waitForEditor(client, tabId);
  if (created) {
    // Fresh tab: ChatGPT's React app needs a moment after the editor becomes
    // visible before it reliably accepts keyboard input + Enter. Without this,
    // the first send on a brand-new tab can be silently dropped.
    await sleep(2000);
  }

  // 2. Capture the last assistant message's identity (data-message-id) so we
  //    can detect the new turn. Counting messages is unreliable: ChatGPT
  //    virtualizes long conversations and recycles DOM nodes, so the count
  //    can stay flat while the last message's text changes.
  const beforeSig = await client.evaluate(
    tabId,
    `(() => { const m=document.querySelectorAll('${SELECTORS.assistantMessages}'); return m.length? m[m.length-1].getAttribute('data-message-id') : null; })()`
  );

  // 3. Send the message.
  await send(client, tabId, message);
  console.error("message sent, waiting for response to finish...");

  // 4. Wait for the response to finish streaming and read it back.
  const response = await waitForResponse(client, tabId, beforeSig);
  if (!response) {
    console.error("ERROR: no response received from ChatGPT");
    process.exit(1);
  }

  // 5. Persist the conversation URL for next time.
  const currentUrl = await client.evaluate(tabId, "location.href");
  if (currentUrl && /\/c\//.test(currentUrl)) persistUrl(currentUrl);

  // 6. Print only ChatGPT's response text to stdout.
  process.stdout.write(response + "\n");
}

main().catch((err) => {
  if (err instanceof LoggedOutError) {
    console.error(`ERROR: ${err.message}`);
  } else if (err.message && err.message.includes("ECONNREFUSED")) {
    console.error("ERROR: camofox-browser server not running");
  } else {
    console.error(`ERROR: ${err.message}`);
  }
  process.exit(1);
});
