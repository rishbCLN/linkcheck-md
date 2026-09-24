# Contributing to linkcheck

Thanks for helping! linkcheck is a small, **zero-dependency** Node CLI, and the goal
is to keep it that way: fast, obvious, cross-platform, and safe to run in CI.

## Principles

- **No runtime dependencies.** Everything uses Node built-ins (`node:fs`,
  `node:path`, `node:url`, and the global `fetch`). PRs that add a dependency will be
  asked to remove it. The Markdown parser, the file walker, the glob matcher and the
  concurrency limiter are all implemented here on purpose.
- **The core is pure; the edges are injected.** Link extraction (`src/extract.mjs`),
  classification (`src/classify.mjs`), slugging (`src/slug.mjs`) and reporting
  (`src/report.mjs`) are pure functions with no I/O. The filesystem and the network
  are passed into `src/check.mjs` as an injectable `fs` and `httpClient`, so the whole
  pipeline is tested with synchronous stubs — **the test suite never opens a socket
  and never hangs.**
- **Safe and polite by default.** Every request has an `AbortController` timeout and a
  hard redirect cap, concurrency is bounded, a descriptive `User-Agent` is sent, and
  non-`http(s)` schemes (`mailto:`, `tel:`, …) are skipped rather than fetched. The
  tool only ever reads files — it never writes to the docs it scans.

## Getting started

```bash
git clone https://github.com/YOUR_USERNAME/linkcheck-md.git
cd linkcheck-md
node --test                       # run the suite
node bin/linkcheck.mjs --help     # try it
node bin/linkcheck.mjs --no-external README.md
```

There's nothing to install — no `npm install` step.

## Adding behaviour or fixing a parser

Markdown is fiddly, so lean on the tests:

1. Add a small fixture string to `test/extract.test.mjs` (or the relevant file) that
   reproduces the case, including the expected **line numbers**.
2. Make the pure function pass. Keep `src/check.mjs` thin.
3. If the change touches the network path, drive it with a **stub `httpClient`** in
   `test/check.test.mjs` — never a real host.

## Before you open a PR

- Run `node --test` — CI runs the same on Windows, macOS, and Linux across Node
  18/20/22, and then dogfoods linkcheck on its own docs.
- Keep the change focused and update the README if you touch the CLI surface.

## Ideas / good first issues

- `--cache` to skip recently-OK URLs.
- JUnit output for CI dashboards.
- Setext/HTML-anchor coverage improvements.
- A short demo GIF for the README.
