---
title: Contributing
summary: Open this when you are forking or renaming this package, updating LICENSE copyright, or publishing it to npm / pi.dev.
---

# Contributing

## Publishing this package

If you fork/rename this, before running `npm publish`:

1. Update `name`, `homepage`, and `repository` in `package.json`.
2. Update the copyright line in `LICENSE`.
3. `npm login`, then `npm publish --access public`.

Add the `pi-package` keyword (already present) so it's discoverable at
[pi.dev/packages](https://pi.dev/packages).

## Type-checking

The extension is written against `@earendil-works/pi-coding-agent`'s
published types. After `npm install`, a type check will catch any drift
against your installed Pi version:

```bash
npx tsc --noEmit
```

## Layout reminder when editing

- `src/index.ts` — the extension entry point (tool registrations, profile
  resolution, tab→profile ownership).
- `deploy/` — server launcher, wake script, and the `camofox-vnc-fit/` plugin
  source (see [server-internals.md](server-internals.md)).
- `skills/` — bundled skills shipped with the extension and discovered via
  the `resources_discover` event.
- `docs/` — this documentation set; keep [INDEX.md](INDEX.md) in sync when
  adding/removing a topic file.
