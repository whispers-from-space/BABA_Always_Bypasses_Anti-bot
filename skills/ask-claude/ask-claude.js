// ask-claude.js
//
// Send a message to Claude (claude.ai) via the shared camofox-browser server
// and print its response. Shares the exact logged-in session that interactive
// camofox_open uses -- profile is resolved from
// ~/.pi/agent/camoufox-harness.json (claude.ai -> "gmail") and the userId
// from .camofox/pi-profiles.json, via lib/camofox-client.js.
//
// Run: node ask-claude.js "your message here"
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

const CLAUDE_URL = "https://claude.ai/new";

// Profile + userId are resolved the same way camofox_open does, so this script
// reuses the interactive session (no separate login).
const PROFILE = resolveProfileForUrl(CLAUDE_URL); // -> "gmail"
const USER_ID = resolveUserId(PROFILE); // -> "pi-gmail-<hash>" (persisted)

// Persisted conversation URL so a restart/lazy-launch resumes the exact
// conversation by navigating to the stored /chat/<id> URL.
const STATE_DIR = path.join(__dirname, ".state");
const CONVO_URL_FILE = path.join(STATE_DIR, "conversation-url.txt");

// Selectors confirmed against a live Claude DOM snapshot (2026-08):
//  - The composer is a ProseMirror contenteditable (tiptap) identified by the
//    stable data-testid="chat-input" (NOT the fragile ProseMirror class,
//    which is also reused by other editors).
//  - Enter sends (the editor has enterkeyhint="enter"); Shift+Enter inserts a
//    newline. A button[aria-label="Send message"] also appears once there is
//    text, but typing + Enter is the most reliable send path.
//  - Each assistant turn is wrapped in a [data-is-streaming] element. Its
//    value is "true" while streaming and flips to "false" when done. Counting
//    these wrappers is a robust new-turn signature (Claude virtualizes long
//    conversations and recycles DOM nodes, so the count can stay flat).
//  - The response body lives in .font-claude-response inside the wrapper.
//    Reading the wrapper's innerText directly would include the "Claude
//    responded: …" sr-only H2 announcement prefix, so we read .font-claude-
//    response instead.
const SELECTORS = {
  editor: 'div[data-testid="chat-input"]', // div.ProseMirror[contenteditable][role=textbox]
  sendButton: 'button[aria-label="Send message"]',
  assistantTurns: "[data-is-streaming]",
  responseBody: ".font-claude-response",
};

// Generous ceilings; these are wait-for-condition loops, not busy polls.
const TIMEOUTS = {
  editorReady: 30_000, // wait for composer to appear (page hydrated)
  newTurn: 45_000, // wait for a new assistant turn to start
  responseDone: 180_000, // wait for streaming to finish (text stability)
  pollInterval: 800, // ms between stability reads
  stabilityCount: 3, // consecutive identical reads => done
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
    return JSON.stringify({ ready: visible, loggedOut: /\\/login|\\/signin|auth\\.anthropic\\.com/i.test(location.href) });
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

async function send(client, tabId, message) {
  // Clear any leftover draft first. Keyboard mode does not clear the field,
  // and if a previous Enter didn't send, a stale draft would accumulate and
  // garble the next message. Select-all + delete clears the ProseMirror
  // editor reliably.
  await client.evaluate(
    tabId,
    `(() => { const e=document.querySelector('${SELECTORS.editor}'); if(!e) return; e.focus(); const s=getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(e); s.addRange(r); document.execCommand('delete'); })()`
  );
  await humanDelay();

  // Keyboard mode with the (stable) editor selector: the server does
  // page.focus(selector) then types real key events, then presses Enter to
  // send. Newlines are collapsed to spaces: keyboard.type presses Enter per
  // "\n", which would send prematurely, so multi-line input isn't supported
  // here (this skill is for single-line questions).
  const single = message.replace(/\r?\n/g, " ");
  await client.type(tabId, SELECTORS.editor, single, {
    mode: "keyboard",
    delay: 15,
    submit: true,
  });
}

// Poll the DOM until a new assistant turn finishes streaming. A new turn is
// detected by the count of [data-is-streaming] wrappers increasing (robust to
// Claude's conversation virtualization, which recycles DOM nodes and keeps
// the wrapper count flat). Completion is then detected by the last wrapper's
// data-is-streaming attribute flipping to "false" AND text stability across
// `stabilityCount` consecutive reads.
async function waitForResponse(client, tabId, beforeCount) {
  const stateExpr = `(() => {
    const turns = document.querySelectorAll('${SELECTORS.assistantTurns}');
    let count = turns.length;
    let streaming = false;
    let text = "";
    if (count) {
      const last = turns[count - 1];
      streaming = last.getAttribute('data-is-streaming') === 'true';
      const body = last.querySelector('${SELECTORS.responseBody}') || last;
      text = (body.innerText || last.innerText || '').trim();
    }
    return JSON.stringify({ count, streaming, text });
  })()`;

  // Phase 1: wait for a new assistant turn (wrapper count increased).
  const turnDeadline = Date.now() + TIMEOUTS.newTurn;
  let state = null;
  while (Date.now() < turnDeadline) {
    state = JSON.parse((await client.evaluate(tabId, stateExpr)) || "{}");
    if (state.count && state.count > beforeCount) break;
    await sleep(TIMEOUTS.pollInterval);
  }
  if (!state || !state.count || state.count <= beforeCount) {
    throw new Error("no response received from Claude");
  }

  // Phase 2: wait for streaming to finish (data-is-streaming flips to false
  // and text stops changing).
  const doneDeadline = Date.now() + TIMEOUTS.responseDone;
  let stableHits = 0;
  let lastText = "";
  while (Date.now() < doneDeadline) {
    state = JSON.parse((await client.evaluate(tabId, stateExpr)) || "{}");
    const text = state.text || "";
    if (text.length > 0 && text === lastText) {
      if (++stableHits >= TIMEOUTS.stabilityCount && !state.streaming) {
        return text;
      }
    } else {
      stableHits = 0;
    }
    lastText = text;
    await sleep(TIMEOUTS.pollInterval);
  }
  return lastText || "";
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
      console.error('Usage: node ask-claude.js "your message"');
      process.exit(1);
    }
  });
}

async function main() {
  const message = await getMessage();
  if (!message) {
    console.error('Usage: node ask-claude.js "your message"');
    process.exit(1);
  }

  const client = createClient(USER_ID);

  // 1. Reuse an existing tab for this profile if open, else create one.
  //    Navigate to the persisted conversation URL (or claude.ai/new) so a
  //    restart/lazy-launch resumes the exact conversation.
  const startUrl = readPersistedUrl() || CLAUDE_URL;
  const { tabId, created } = await client.getOrCreateTab(PROFILE, startUrl);
  console.error(`using tab ${tabId} (profile=${PROFILE}, created=${created})`);
  // getOrCreateTab already navigated a freshly created tab to startUrl, so
  // only navigate when reusing an existing tab (to resume the persisted
  // conversation). Navigating a brand-new tab again races with its initial
  // load and throws a retryable NS_BINDING_ABORTED 409.
  if (!created) {
    try {
      await client.navigate(tabId, startUrl);
    } catch (err) {
      // A reused tab may already be mid-navigation; a retryable race here is
      // harmless -- fall through and let waitForEditor confirm readiness.
      if (!(err.status === 409 || /pagechanged|navigation_race|NS_BINDING_ABORTED/i.test(err.message || ""))) {
        throw err;
      }
    }
  }

  await waitForEditor(client, tabId);
  if (created) {
    // Fresh tab: Claude's React app needs a moment after the editor becomes
    // visible before it reliably accepts keyboard input + Enter. Without this,
    // the first send on a brand-new tab can be silently dropped.
    await sleep(2000);
  }

  // 2. Capture the assistant-turn count before sending so we can detect the
  //    new turn. Counting wrappers is more reliable than text signatures
  //    here: Claude virtualizes long conversations and recycles DOM nodes,
  //    so the wrapper count is the stable signal.
  const beforeCount = JSON.parse(
    (await client.evaluate(
      tabId,
      `document.querySelectorAll('${SELECTORS.assistantTurns}').length`
    )) || "0"
  );

  // 3. Send the message.
  await send(client, tabId, message);
  console.error("message sent, waiting for response to finish...");

  // 4. Wait for the response to finish streaming and read it back.
  const response = await waitForResponse(client, tabId, beforeCount);
  if (!response) {
    console.error("ERROR: no response received from Claude");
    process.exit(1);
  }

  // 5. Persist the conversation URL for next time.
  const currentUrl = await client.evaluate(tabId, "location.href");
  if (currentUrl && /\/chat\//.test(currentUrl)) persistUrl(currentUrl);

  // 6. Print only Claude's response text to stdout.
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
