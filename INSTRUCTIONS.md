# linkcheck — build instructions

> Self-contained build spec. A fresh session should be able to build, test, and ship this tool by following this file top to bottom. Do not add runtime dependencies.

| Field | Value |
| --- | --- |
| Product name | **linkcheck** |
| Tagline | *Find dead links in your Markdown and docs — locally and in CI.* |
| Folder id | `star-tool7-linkcheck` |
| Intended repo / npm name | `linkcheck` likely taken → prefer `linkcheck-md` / `deadlink-cli` / `mdlinkcheck` (verify) |
| Status | Planned |
| License | MIT |

---

## 1. Problem & audience
Docs rot. READMEs and doc sites accumulate broken links (moved pages, renamed files, typo'd anchors). Nobody notices until a user files an issue. Maintainers want an automated check that runs in CI.

**Audience:** OSS maintainers, docs writers, technical bloggers, teams with `/docs`.

## 2. Why it earns stars
- Slots into CI with a **badge** → shows up in other repos → organic discovery.
- Checks **both** external URLs and **local** file/anchor links (many tools do only one).
- Clear, actionable report; fast via concurrency.

## 3. Scope
**MVP**
- Scan given Markdown files/globs (default: `**/*.md`, honoring `.gitignore`-style excludes via `--ignore`).
- Extract links: `[text](url)`, reference links, bare autolinks, and image `src`.
- Validate:
  - **local** relative links → file exists (and `#anchor` matches a heading slug).
  - **external** `http(s)` → HEAD (fallback GET) with timeout + retries + concurrency limit.
- Report broken links grouped by file with line numbers; exit non-zero if any broken.

**Stretch**
- `--json` and JUnit output for CI.
- `--cache` to skip recently-OK URLs.
- Allowlist/denylist patterns; `--timeout`, `--concurrency`, `--retry`.
- Check HTML files too. Anchor checking for external pages (stretch, opt-in).

**Non-goals**
- Not a full crawler/site spider (scans the files you give it, follows local links only). No JS rendering.

## 4. Tech & constraints
- Node **>= 18**, ESM, **zero runtime deps** — use the built-in global `fetch` (Node 18+).
- `node:fs`, `node:path`, tiny glob via `fs` recursion (no `globby`).
- Entry `bin/linkcheck.mjs`.

## 5. CLI / UX design
```
Usage: linkcheck [globs...] [options]

Options:
  --ignore <patterns>   Comma-separated ignore globs
  --external            Check external URLs too (default: on)
  --no-external         Only check local links/anchors
  --timeout <ms>        Per-request timeout (default: 8000)
  --concurrency <n>     Max parallel requests (default: 8)
  --retry <n>           Retries for transient failures (default: 1)
  --json                JSON report
  -h, --help
  -v, --version
```

Example:
```
$ npx linkcheck "docs/**/*.md" README.md
scanned 24 files · 312 links (58 external, 254 local)

README.md
  ✗ line 40  ./CONTRIBUTNG.md          (file not found)
  ✗ line 88  https://old.example.com   (404)
docs/setup.md
  ✗ line 12  #instalation              (no matching heading)

3 broken links found.
```

## 6. Architecture & file layout
```
linkcheck/
  bin/linkcheck.mjs
  src/scan.mjs        # walk globs -> files (respect ignore)
  src/extract.mjs     # pure: markdown text -> [{url, line, type}]
  src/slug.mjs        # pure: heading -> GitHub-style anchor slug
  src/checkLocal.mjs  # file existence + anchor match (pure-ish)
  src/checkHttp.mjs   # fetch w/ timeout, retry, concurrency pool
  src/report.mjs      # pure: results -> human/json
  src/args.mjs
  test/extract.test.mjs
  test/slug.test.mjs
  test/report.test.mjs
  package.json
  README.md
  LICENSE
  CONTRIBUTING.md
  .github/workflows/ci.yml   # also: self-check its own docs
  .gitignore
```

## 7. Implementation steps
1. Scaffold package.json/bin/license/gitignore.
2. `extract.mjs`: regex/state parse of links (inline, reference, autolink, images) with line numbers. **Pure + heavily tested** (markdown is fiddly).
3. `slug.mjs`: GitHub-compatible heading→slug (lowercase, strip punctuation, spaces→`-`, dedupe `-1`). Tested against known cases.
4. `checkLocal.mjs`: resolve relative path from the file's dir; verify file exists; if `#anchor`, parse target file headings → slugs → match.
5. `checkHttp.mjs`: concurrency pool (Promise queue), `fetch` with `AbortController` timeout, HEAD→GET fallback, retry transient (5xx/timeout), treat 401/403 as "OK-ish" (reachable) with a note.
6. `report.mjs` + `args.mjs` + `scan.mjs`; wire `bin`; exit non-zero on any broken.
7. Tests + CI (self-check its own README/docs) + README + badge snippet.

## 8. Edge cases & safety
- **Read-only + polite:** set a descriptive `User-Agent`; cap concurrency; add small jitter; honor `--timeout`. Never hammer a host (per-host concurrency cap). This is a checker, not a load tester.
- `mailto:`/`tel:`/`data:` schemes skipped (report as ignored).
- Anchors on external pages not fetched by default (avoid false negatives).
- Rate-limited (429) → back off + retry once, then report as "rate-limited" not "broken".
- Deterministic exit codes: 0 = all good, 1 = broken links, 2 = usage error.
- Only reads local files within provided globs; makes only GET/HEAD requests (no writes, no auth).

## 9. Testing plan (`node --test`)
- `extract`: inline/reference/autolink/image, ignores code fences + inline code.
- `slug`: spaces, punctuation, duplicate headings, unicode.
- `checkLocal`: existing/missing file; matching/missing anchor.
- `report`: grouping by file + correct exit intent; JSON shape.
- HTTP layer tested against a local `node:http` stub server (200/404/timeout/redirect).

## 10. README outline
Badges (incl. its own linkcheck badge) → "docs rot" pain → `npx linkcheck` report screenshot → CI usage + badge snippet → options → how it works → install → contributing → license.

## 11. Distribution
`npm publish` (final name after availability check), bin + shebang, tag, Release. Provide a ready-to-copy GitHub Actions step.

## 12. Launch checklist
Report screenshot + CI snippet → Show HN → r/opensource, r/technicalwriting, r/node → dev.to → add to `awesome-zero-dependency`.

## 13. Definition of Done + star-magnet checklist
- [ ] Checks local files, anchors, and external URLs.
- [ ] Concurrency + timeout + retry; polite to hosts.
- [ ] CI-friendly exit codes + `--json`; copy-paste Actions step.
- [ ] Self-checks its own docs in its own CI (dogfood).
- [ ] CI green; tests pass; published; listed in awesome list.
