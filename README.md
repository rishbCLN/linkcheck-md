# linkcheck

[![CI](https://github.com/rishbCLN/linkcheck-md/actions/workflows/ci.yml/badge.svg)](https://github.com/rishbCLN/linkcheck-md/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/linkcheck-md.svg)](https://www.npmjs.com/package/linkcheck-md)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Find dead links in your Markdown and docs — locally and in CI.**

> Published on npm as **`linkcheck-md`** (the bare `linkcheck` name is reserved); it
> installs a `linkcheck` command.

Docs rot. READMEs and doc sites quietly accumulate broken links — a page moves, a file
gets renamed, a heading is retitled and every `#anchor` to it dies. Nobody notices
until a user files an issue. `linkcheck` finds them first, and fails your CI build
before the broken links ever ship:

```bash
npx linkcheck-md "docs/**/*.md" README.md
```

```
scanned 24 files · 312 links (58 external, 254 local)

README.md
  ✗ line 40  ./CONTRIBUTNG.md         (file not found)
  ✗ line 88  https://old.example.com  (404)
docs/setup.md
  ✗ line 12  #instalation             (no matching heading)

✗ 3 broken links found
```

It checks **both** local links and external URLs:

- **Local files** — relative links resolve against the file, and missing targets are
  reported (`./CONTRIBUTNG.md` above is a typo for `CONTRIBUTING.md`).
- **Anchors** — `#fragment` links are matched against the target document's real
  heading slugs (GitHub-style), so renamed headings are caught.
- **External URLs** — `http(s)` links are checked with `HEAD` (falling back to `GET`),
  following redirects, with a per-request timeout, retries, and bounded concurrency.

No dependencies. No config. No account. Just Node 18+.

<!-- Add a short demo GIF here once recorded: ![demo](docs/demo.gif) -->

## Quick start

```bash
# one-off, no install — scan the current directory
npx linkcheck-md

# scan specific files, directories, or globs
npx linkcheck-md "docs/**/*.md" README.md

# check local links + anchors only (no network)
npx linkcheck-md . --no-external

# or install globally (exposes the `linkcheck` command)
npm install -g linkcheck-md
linkcheck .
```

## Use it in CI

`linkcheck` exits non-zero the moment a link is dead, so a single step gates your
build. Drop this into `.github/workflows/docs.yml`:

```yaml
name: Docs
on: [push, pull_request]

jobs:
  linkcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # exits 1 if any link is dead -> the job fails
      - run: npx linkcheck-md "**/*.md"
```

Prefer to fail only on local breakage (and never on a flaky third-party host)? Use
`--no-external`. For machine-readable output, add `--json`.

## Usage

```
linkcheck [paths...] [options]
```

| Option | Description |
| --- | --- |
| `--ignore <globs>` | Comma-separated globs to skip (repeatable) |
| `--allow <patterns>` | URL substrings/globs to treat as OK and skip (repeatable) |
| `--no-external` | Only check local files and anchors (no network) |
| `--offline` | Alias for `--no-external` |
| `--timeout <ms>` | Per-request timeout (default: `8000`) |
| `--concurrency <n>` | Max parallel requests (default: `8`) |
| `--retry <n>` | Retries for transient failures (default: `1`) |
| `--json` | Output a JSON report |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

Exit codes: `0` no broken links, `1` one or more broken links, `2` usage error.

## How it works

No magic — just a small, well-tested pipeline over Node built-ins:

1. **Walk** the given paths/globs for `*.md` / `*.markdown` (skipping `node_modules`,
   `.git`, and anything in `--ignore`).
2. **Extract** every link — inline `[text](url)`, reference `[text][id]` + definitions,
   autolinks `<https://…>`, and images `![alt](url)` — while ignoring links inside
   fenced code, indented code, and inline code spans. Each link keeps its line number.
3. **Classify** each target as external, relative-file, anchor, or a skipped scheme
   (`mailto:`, `tel:`, …).
4. **Check** them: local paths via the filesystem (and `#anchor`s against heading
   slugs), external URLs over the network with `HEAD`→`GET`, redirect-following up to a
   cap, an `AbortController` timeout, retries, and a bounded-concurrency pool.
5. **Report** grouped by file with line numbers and a CI-friendly exit code.

The parsing, classification, slugging, and reporting are **pure functions**; the
filesystem and network are **injected**, which is why the test suite is fast and never
touches the internet.

## Safety

- **Read-only.** linkcheck only ever reads the files you point it at — it never
  modifies your docs. It makes only `HEAD`/`GET` requests, never writes or auth.
- **Can't hang.** Every request has an `AbortController` timeout and a hard redirect
  cap, and concurrency is bounded — so it always terminates.
- **Polite.** Sends a descriptive `User-Agent`, limits parallelism, and treats
  rate-limits (`429`) and `401/403` as reachable warnings rather than hard failures.
- **Skips what it shouldn't fetch.** `mailto:`, `tel:`, `javascript:`, `data:` and
  friends are reported as skipped, never requested.

## Dogfooding

linkcheck checks its own `README.md` and `CONTRIBUTING.md` in its own CI (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)) — if these docs ever grow a
broken local link, the build goes red.

## Development

```bash
node --test                                    # run the suite (Node built-in, zero deps)
node bin/linkcheck.mjs --help
node bin/linkcheck.mjs --no-external README.md  # check this file's local links offline
```

The Markdown handling lives in small pure modules (`src/extract.mjs`,
`src/classify.mjs`, `src/slug.mjs`, `src/report.mjs`) that are unit-tested against
fixtures, while `src/check.mjs` takes an injectable `fs` + `httpClient`, so
contributions are easy to verify.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
