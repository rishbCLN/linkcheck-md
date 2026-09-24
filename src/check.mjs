// Orchestrator: turn extracted links into checked results. All side effects — the
// filesystem and the network — are injected, so the whole pipeline can be tested
// with synchronous stubs and never touches a real socket. Includes a small PURE
// concurrency limiter and a redirect-following, HEAD->GET external checker.
import { promises as realFs } from 'node:fs';
import path from 'node:path';

import { extractLinks, extractHeadings, extractHtmlAnchors } from './extract.mjs';
import { slugifyHeadings } from './slug.mjs';
import { classifyLink } from './classify.mjs';

export const USER_AGENT = 'linkcheck-md (+https://github.com/YOUR_USERNAME/linkcheck-md)';

/** Minimal fs surface the checker needs — swapped out wholesale in tests. */
export const defaultFs = {
  readFile: (p, enc) => realFs.readFile(p, enc),
  stat: (p) => realFs.stat(p),
};

/**
 * PURE bounded-concurrency map. Runs `worker` over `items` with at most `limit`
 * calls in flight at once, preserving result order and completing them all.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function pool(items, limit, worker) {
  const list = Array.from(items);
  const results = new Array(list.length);
  if (list.length === 0) return results;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, list.length));
  let next = 0;
  async function runner() {
    while (next < list.length) {
      const i = next++;
      results[i] = await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: width }, () => runner()));
  return results;
}

/**
 * Default low-level HTTP client built on global fetch. Does ONE request with a hard
 * timeout (AbortController) and does NOT auto-follow redirects (the caller counts
 * hops), so the tool can never hang or loop.
 * @returns {Promise<{ status: number, headers: { location?: string } }>}
 */
export async function defaultHttpClient(url, opts = {}) {
  const { method = 'GET', timeoutMs = 8000, userAgent = USER_AGENT } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept: '*/*' },
    });
    return { status: res.status, headers: { location: res.headers.get('location') || undefined } };
  } finally {
    clearTimeout(timer);
  }
}

const isRedirect = (status) => status >= 300 && status < 400;

/**
 * Issue a request and follow redirects up to `maxRedirects` hops. Returns the final
 * status, or `{ tooManyRedirects: true }` if the cap is exceeded. May throw if the
 * injected client throws (network error / timeout).
 */
async function requestFollowing(client, url, method, { timeout, maxRedirects }) {
  let current = url;
  for (let hops = 0; ; hops++) {
    const res = await client(current, { method, timeoutMs: timeout });
    const location = res.headers && res.headers.location;
    if (isRedirect(res.status) && location) {
      if (hops >= maxRedirects) return { tooManyRedirects: true, status: res.status };
      try {
        current = new URL(location, current).toString();
      } catch {
        return { status: res.status };
      }
      continue;
    }
    return { status: res.status };
  }
}

/**
 * Check one external URL: HEAD first, fall back to GET when HEAD is rejected, follow
 * redirects within the cap, and retry transient failures (5xx / 429 / network).
 * @returns {Promise<{ state: 'ok'|'warn'|'dead', status?: number, note?: string }>}
 */
export async function checkExternalUrl(url, opts = {}) {
  const client = opts.client || defaultHttpClient;
  const timeout = opts.timeout ?? 8000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const retry = opts.retry ?? 1;

  const attempt = async () => {
    let res = await requestFollowing(client, url, 'HEAD', { timeout, maxRedirects });
    if (!res.tooManyRedirects && typeof res.status === 'number' && res.status >= 400) {
      res = await requestFollowing(client, url, 'GET', { timeout, maxRedirects });
    }
    return res;
  };

  let res;
  for (let a = 0; a <= retry; a++) {
    try {
      res = await attempt();
    } catch (err) {
      const msg = err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || 'network error';
      if (a < retry) continue;
      return { state: 'dead', note: msg };
    }
    if (res.tooManyRedirects) return { state: 'dead', status: res.status, note: 'too many redirects' };
    const status = res.status;
    if (status >= 200 && status < 400) return { state: 'ok', status };
    if (status === 429) {
      if (a < retry) continue;
      return { state: 'warn', status, note: 'rate limited (429)' };
    }
    if (status === 401 || status === 403) return { state: 'warn', status, note: `reachable (${status})` };
    if (status >= 500) {
      if (a < retry) continue;
      return { state: 'dead', status, note: `server error (${status})` };
    }
    return { state: 'dead', status, note: `HTTP ${status}` };
  }
  return { state: 'dead', note: 'request failed' };
}

/** Build the set of valid anchor targets for a document (heading slugs + HTML ids). */
export function slugSet(content) {
  const set = new Set();
  for (const s of slugifyHeadings(extractHeadings(content))) set.add(s);
  for (const a of extractHtmlAnchors(content)) {
    set.add(a);
    set.add(String(a).toLowerCase());
  }
  return set;
}

async function statSafe(fs, target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

/**
 * Check a local target: does the file exist, and (if an #anchor is present) does the
 * target contain a matching heading/anchor?
 * @param {string} absPath
 * @param {string|null} anchor
 * @param {{ fs?: any, slugCache?: Map<string, Set<string>> }} [opts]
 * @returns {Promise<{ state: 'ok'|'dead', note?: string }>}
 */
export async function checkLocal(absPath, anchor, opts = {}) {
  const fs = opts.fs || defaultFs;
  const cache = opts.slugCache;
  const st = await statSafe(fs, absPath);
  if (!st) return { state: 'dead', note: 'file not found' };
  if (!anchor) return { state: 'ok' };
  if (st.isDirectory && st.isDirectory()) return { state: 'ok', note: 'anchor not checked (directory)' };

  let slugs = cache && cache.get(absPath);
  if (!slugs) {
    let content;
    try {
      content = await fs.readFile(absPath, 'utf8');
    } catch {
      return { state: 'dead', note: 'file not found' };
    }
    slugs = slugSet(content);
    if (cache) cache.set(absPath, slugs);
  }

  const a = String(anchor);
  if (slugs.has(a) || slugs.has(a.toLowerCase())) return { state: 'ok' };
  return { state: 'dead', note: 'no matching heading' };
}

/** Does `url` match any allow/ignore pattern (substring, or a `*`/`?` wildcard)? */
export function matchesAny(url, patterns = []) {
  const u = String(url);
  for (const raw of patterns) {
    const pat = String(raw).trim();
    if (!pat) continue;
    if (/[*?]/.test(pat)) {
      const re = new RegExp(
        `^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
      );
      if (re.test(u)) return true;
    } else if (u.includes(pat)) {
      return true;
    }
  }
  return false;
}

function summarize(results, filesScanned) {
  const summary = {
    files: filesScanned,
    links: 0,
    ok: 0,
    dead: 0,
    warn: 0,
    skipped: 0,
    external: 0,
    local: 0,
  };
  for (const r of results) {
    summary.links += 1;
    if (r.state === 'dead') summary.dead += 1;
    else if (r.state === 'ok') summary.ok += 1;
    else if (r.state === 'warn') summary.warn += 1;
    if (r.kind === 'external') summary.external += 1;
    else if (r.kind === 'relative' || r.kind === 'anchor') summary.local += 1;
    else if (r.kind === 'skip') summary.skipped += 1;
  }
  return summary;
}

/**
 * Check every link in every file. Reads files + hits the network through injected
 * `fs` / `httpClient`, so this is fully driveable from tests.
 * @param {string[]} files  absolute (or cwd-relative) Markdown file paths
 * @param {object} [opts]
 * @returns {Promise<{ results: Array<object>, summary: object }>}
 */
export async function checkAll(files, opts = {}) {
  const fs = opts.fs || defaultFs;
  const client = opts.httpClient || defaultHttpClient;
  const timeout = opts.timeout ?? 8000;
  const concurrency = opts.concurrency ?? 8;
  const retry = opts.retry ?? 1;
  const maxRedirects = opts.maxRedirects ?? 5;
  const external = opts.external !== false;
  const allow = opts.allow || [];

  const results = [];
  const externalTasks = [];
  const slugCache = new Map();

  for (const file of files) {
    let content;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch (err) {
      results.push({
        file,
        line: 0,
        url: null,
        type: 'file',
        kind: 'file',
        state: 'dead',
        note: `cannot read file: ${(err && err.message) || err}`,
      });
      continue;
    }

    const ownSlugs = slugSet(content);
    slugCache.set(path.resolve(file), ownSlugs);
    const links = extractLinks(content);

    for (const link of links) {
      if (link.undefinedReference) {
        results.push({
          file,
          line: link.line,
          url: `[${link.id}]`,
          type: link.type,
          kind: 'reference',
          state: 'dead',
          note: `undefined reference "${link.id}"`,
        });
        continue;
      }

      const info = classifyLink(link.url);
      const base = { file, line: link.line, url: link.url, type: link.type, kind: info.kind };

      if (info.kind === 'skip') {
        results.push({ ...base, state: 'skipped', note: info.scheme ? `${info.scheme}: skipped` : 'skipped' });
      } else if (info.kind === 'anchor') {
        const anchor = String(info.anchor);
        const ok = ownSlugs.has(anchor) || ownSlugs.has(anchor.toLowerCase());
        results.push({ ...base, state: ok ? 'ok' : 'dead', note: ok ? undefined : 'no matching heading' });
      } else if (info.kind === 'relative') {
        const targetAbs = path.resolve(path.dirname(file), info.path);
        const r = await checkLocal(targetAbs, info.anchor, { fs, slugCache });
        results.push({ ...base, state: r.state, note: r.note });
      } else if (info.kind === 'external') {
        if (!external) {
          results.push({ ...base, state: 'skipped', note: 'external check disabled' });
        } else if (matchesAny(info.url, allow)) {
          results.push({ ...base, state: 'skipped', note: 'allowlisted' });
        } else {
          const result = { ...base, state: 'pending' };
          results.push(result);
          externalTasks.push({ result, url: info.url });
        }
      }
    }
  }

  await pool(externalTasks, concurrency, async (task) => {
    const r = await checkExternalUrl(task.url, { client, timeout, maxRedirects, retry });
    task.result.state = r.state;
    if (r.status !== undefined) task.result.status = r.status;
    task.result.note = r.note;
    return r;
  });

  return { results, summary: summarize(results, files.length) };
}
