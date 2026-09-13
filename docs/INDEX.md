# Documentation index

Pointer list only — no content here. Open the file whose trigger matches your task.
For install/quick-start commands see the top-level [../README.md](../README.md).

| File | When to open it |
|---|---|
| [setup.md](setup.md) | You are installing, upgrading, or uninstalling the extension, or need to set `CAMOFOX_URL` / `CAMOFOX_API_KEY` for the client. |
| [tools.md](tools.md) | You want the exact list of `camofox_*` tools this extension registers, their parameters, or end-to-end usage examples. |
| [profiles.md](profiles.md) | You are configuring `~/.pi/agent/camoufox-harness.json` (URL→profile mapping, `defaultProfile`), or you need to get a profile logged into a site (VNC manual login). |
| [architecture.md](architecture.md) | You need to know how a Pi session maps onto camofox-browser internals — `userId`/profiles, one-BrowserContext-per-profile, the single shared VNC display, or stale-tab cleanup. |
| [data.md](data.md) | You need to know what lives under `<extension>/.camofox/` (profiles, cookies, traces, `pi-profiles.json`, `tab-owners.json`, stable fingerprint), what's git-ignored, or what's safe to move/delete. |
| [server.md](server.md) | You are starting, stopping, waking, configuring (env table), or debugging the camofox-browser server itself. |
| [server-internals.md](server-internals.md) | An `npm`/npx upgrade broke VNC, or you want to understand the launcher's self-healing patches (playwright-core pin, vnc-fit plugin) and user-space VNC dependencies. |
| [troubleshooting.md](troubleshooting.md) | Something 404'd or behaves unexpectedly and you want the known caveats + a checklist for verifying endpoints against your own camofox-browser instance. |
| [contributing.md](contributing.md) | You are forking/renaming this package, updating LICENSE copyright, or publishing to npm / pi.dev. |
