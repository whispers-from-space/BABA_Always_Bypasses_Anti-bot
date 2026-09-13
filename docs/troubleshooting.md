---
title: Troubleshooting
summary: Open this when something 404'd, behaves unexpectedly, or you need the known caveats and a checklist for verifying the camofox-browser endpoints this extension calls against your own instance.
---

# Troubleshooting

This package's tool/command set was cross-checked against the upstream
[jo-inc/camofox-browser README](https://github.com/jo-inc/camofox-browser) —
endpoint paths, request bodies, and env var names below match that document
as of when this was written. Still worth re-checking against your own
instance's `/openapi.json` if something 404s:

```bash
curl http://localhost:9377/openapi.json   # the source of truth for your build
```

## Known caveats

- **No per-session display toggle exists.** VNC access is enabled for the
  *whole server* at startup via `ENABLE_VNC=1` (optionally `VNC_PASSWORD`) —
  it cannot be turned on remotely per-profile. If your server wasn't started
  with `ENABLE_VNC=1`, VNC manual login won't work — restart the server with
  the launcher (see [server.md](server.md)). The single shared VNC display is
  documented in [architecture.md](architecture.md).

- **`GET /sessions/:userId/storage_state`** is documented under
  camofox-browser's VNC plugin specifically. If your build doesn't ship that
  plugin, this call may 404.

- **All per-tab tools forward `userId`.** `camofox_snapshot`/`click`/`type`/
  `navigate`/`screenshot`/`tab_stats`/`close_tab` all require `userId`
  (passed here as `profile`, resolved internally) in addition to `tabId` —
  the upstream API needs it even though the tab id alone looks like it should
  be enough. Every tool in this package passes it (the extension tracks
  tab→profile ownership in `tab-owners.json`, see [data.md](data.md)); if you
  call the REST API yourself, append `?userId=<id>`.
  *(The old README's note that `camofox_screenshot` did not forward `userId`
  is **outdated** — it does, via the same ownership lookup as the other
  per-tab tools.)*

- **Cookie import is NOT wrapped by this extension.** The upstream endpoint
  `POST /sessions/:userId/cookies` exists and this package exposes no tool
  for it. If you call it yourself over HTTP, note:
  - It requires `CAMOFOX_API_KEY` set identically on the client and the
    camofox-browser server, or the server returns 403.
  - The server enforces a **500-cookie / 5MB cap** per import request.
  - Cookie files would need to be parsed into cookie objects before POSTing
    (the upstream endpoint takes parsed cookies, not a raw Netscape file).
  - If camofox-browser runs on a different machine than Pi, the cookie file
    needs to be readable from wherever you run the import call.

- **Endpoints this package doesn't wrap yet**, but that exist upstream and
  could be added: `press`, `scroll`, `wait`, `back`/`forward`/`refresh`,
  `links`, `images`, `downloads`, `extract` (structured JSON Schema
  extraction), session tracing, and YouTube transcript extraction — see the
  [API table upstream](https://github.com/jo-inc/camofox-browser#api).
  *(Note: `tab stats` **is** wrapped, as `camofox_tab_stats` — it is not in
  this unwrapped list.)*

- **No retry/backoff** on the extension's fetch helper yet — a transient
  failure just throws with a message pointing at `CAMOFOX_URL`. Fine for
  interactive use; worth hardening for unattended runs.

- **Scaling to a second server**: if a specific site ever correlates/flags
  repeated fingerprint reuse across its different logins, stand up a *second*
  dedicated instance (change `CAMOFOX_PORT` in the launcher, point that
  site's workflow at it via `CAMOFOX_URL` per-process) — this is the
  documented exception, not the default.

- **Pi extension API surface.** Built and type-checked against
  `@earendil-works/pi-coding-agent`'s published types (`registerTool`,
  `registerCommand`, `resources_discover`). If your installed Pi version has
  since changed these shapes, `npx tsc --noEmit` in this package will catch
  it after `npm install`.
