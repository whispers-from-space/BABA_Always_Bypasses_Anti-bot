// ask-gemini.js
//
// Send a chat message to Gemini (gemini.google.com) via the shared
// camofox-browser server and print its response. Shares the exact logged-in
// session that interactive camofox_open uses -- profile is resolved from
// ~/.pi/agent/camoufox-harness.json (gemini.google.com -> "gmail") and the
// userId from .camofox/pi-profiles.json, via lib/camofox-client.js.
//
// Run: node ask-gemini.js "your message here"
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

const GEMINI_URL = "https://gemini.google.com/";

// Profile + userId are resolved the same way camofox_open does, so this script
// reuses the interactive session (no separate login).
const PROFILE = resolveProfileForUrl(GEMINI_URL); // -> "gmail"
const USER_ID = resolveUserId(PROFILE); // -> "pi-gmail-<hash>" (persisted)

// Persisted conversation URL so a restart/lazy-launch resumes the exact
// conversation by navigating to the stored /app/<id> URL.
const STATE_DIR = path.join(__dirname, ".state");
const CONVO_URL_FILE = path.join(STATE_DIR, "conversation-url.txt");

// Selectors confirmed against a live Gemini DOM snapshot (2026-08):
//  - The composer is a Quill contenteditable (.ql-editor). The earlier
//    `div[contenteditable], rich-textarea, [role=textbox]` selector was
//    ambiguous (matched 3 elements); .ql-editor[contenteditable] is unique.
//  - Enter sends (the rich-textarea has enterkeyhint="send").
//  - Model responses live in .model-response-text.
const SELECTORS = {
  editor: ".ql-editor[contenteditable=true]",
  assistantMessages: ".model-response-text",
};

const TIMEOUTS = {
  editorReady: 30_000,
  newTurn: 45_000,
  responseDone: 180_000,
  pollInterval: 800,
  stabilityCount: 3,
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

async function waitForEditor(client, tabId) {
  const expr = `(() => {
    const el = document.querySelector('${SELECTORS.editor}');
    if (!el) return JSON.stringify({ ready: false });
    const visible = !!(el.offsetWidth || el.offsetHeight);
    return JSON.stringify({ ready: visible, loggedOut: /accounts\\.google\\.com|\\/signin/i.test(location.href) });
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
  // Collapse newlines: keyboard.type presses Enter per "\n", which would
  // send prematurely (single-line questions only).
  const single = message.replace(/\r?\n/g, " ");

  // Clear any leftover draft first. Keyboard mode does not clear the field,
  // and if a previous Enter didn't send, a stale draft would accumulate and
  // garble the next message. Select-all + delete via the selection API clears
  // the Quill editor reliably.
  await client.evaluate(
    tabId,
    `(() => { const e=document.querySelector('${SELECTORS.editor}'); if(!e) return; e.focus(); const s=getSelection(); s.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(e); s.addRange(r); document.execCommand('delete'); })()`
  );
  await humanDelay();

  // Keyboard mode with the (unambiguous) editor selector: the server does
  // page.focus(selector) then types real key events, then presses Enter to
  // send.
  await client.type(tabId, SELECTORS.editor, single, {
    mode: "keyboard",
    delay: 20,
    submit: true,
  });
  await humanDelay();
}

// Poll the DOM until a new model turn finishes streaming. A new turn is
// detected by the last .model-response-text's text changing from the
// pre-send signature (robust to Gemini's conversation virtualization, which
// keeps the response count flat). Completion is then detected by text
// stability across `stabilityCount` consecutive reads.
async function waitForResponse(client, tabId, beforeSig) {
  const stateExpr = `(() => {
    const msgs = document.querySelectorAll('${SELECTORS.assistantMessages}');
    let last = null;
    if (msgs.length) last = msgs[msgs.length - 1].innerText || '';
    return JSON.stringify({ text: last || '' });
  })()`;

  // Phase 1: wait for the new model turn (its text differs from beforeSig).
  const turnDeadline = Date.now() + TIMEOUTS.newTurn;
  let state = null;
  while (Date.now() < turnDeadline) {
    state = JSON.parse((await client.evaluate(tabId, stateExpr)) || "{}");
    if (state.text && state.text !== beforeSig) break;
    await sleep(TIMEOUTS.pollInterval);
  }
  if (!state || !state.text || state.text === beforeSig) {
    throw new Error("no response received from Gemini");
  }

  // Phase 2: wait for streaming to finish (text stability).
  const doneDeadline = Date.now() + TIMEOUTS.responseDone;
  let stableHits = 0;
  let lastText = "";
  while (Date.now() < doneDeadline) {
    state = JSON.parse((await client.evaluate(tabId, stateExpr)) || "{}");
    const text = state.text || "";
    if (text.length > 0 && text === lastText) {
      if (++stableHits >= TIMEOUTS.stabilityCount) return text;
    } else {
      stableHits = 0;
    }
    lastText = text;
    await sleep(TIMEOUTS.pollInterval);
  }
  return lastText || "";
}

async function main() {
  const message = process.argv[2];
  if (!message) {
    console.error('Usage: node ask-gemini.js "your message"');
    process.exit(1);
  }

  const client = createClient(USER_ID);

  // 1. Reuse an existing tab for this profile if open, else create one.
  const startUrl = readPersistedUrl() || GEMINI_URL;
  const { tabId, created } = await client.getOrCreateTab(PROFILE, startUrl);
  console.error(`using tab ${tabId} (profile=${PROFILE}, created=${created})`);
  await client.navigate(tabId, startUrl);

  await waitForEditor(client, tabId);
  if (created) {
    // Fresh tab: let Gemini's Angular app settle after the editor becomes
    // visible before sending, so the first message isn't dropped.
    await sleep(2000);
  }

  // 2. Capture the last model response's text as a signature so we can
  //    detect the new turn. Counting messages is unreliable: Gemini
  //    virtualizes long conversations and keeps the response count flat while
  //    the last response's text changes.
  const beforeSig = await client.evaluate(
    tabId,
    `(() => { const m=document.querySelectorAll('${SELECTORS.assistantMessages}'); return m.length? (m[m.length-1].innerText||'') : ''; })()`
  );

  // 3. Send the message.
  await send(client, tabId, message);
  console.error("message sent, waiting for response to finish...");

  // 4. Wait for the response to finish streaming and read it back.
  const response = await waitForResponse(client, tabId, beforeSig);
  if (!response) {
    console.error("ERROR: no response received from Gemini");
    process.exit(1);
  }

  // 5. Persist the conversation URL for next time.
  const currentUrl = await client.evaluate(tabId, "location.href");
  if (currentUrl && /\/app\//.test(currentUrl)) persistUrl(currentUrl);

  // 6. Print only Gemini's response text to stdout.
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
