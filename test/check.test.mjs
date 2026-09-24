import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  pool,
  checkExternalUrl,
  checkLocal,
  checkAll,
  matchesAny,
} from '../src/check.mjs';
import { computeExitCode } from '../src/report.mjs';

// ---------------------------------------------------------------------------
// concurrency limiter
// ---------------------------------------------------------------------------

test('pool: never exceeds the limit and completes every item in order', async () => {
  let active = 0;
  let maxActive = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const worker = async (x) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return x * 2;
  };
  const results = await pool(items, 3, worker);
  assert.ok(maxActive <= 3, `maxActive was ${maxActive}`);
  assert.equal(maxActive, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
});

test('pool: empty input yields an empty result', async () => {
  const results = await pool([], 4, async () => 1);
  assert.deepEqual(results, []);
});

// ---------------------------------------------------------------------------
// external checking — all via injected, synchronous stub clients (no sockets)
// ---------------------------------------------------------------------------

test('checkExternalUrl: 200 is ok', async () => {
  const client = async () => ({ status: 200, headers: {} });
  const r = await checkExternalUrl('https://x.test', { client, retry: 0 });
  assert.equal(r.state, 'ok');
  assert.equal(r.status, 200);
});

test('checkExternalUrl: 404 is dead', async () => {
  const client = async () => ({ status: 404, headers: {} });
  const r = await checkExternalUrl('https://x.test', { client, retry: 0 });
  assert.equal(r.state, 'dead');
  assert.equal(r.status, 404);
});

test('checkExternalUrl: 500 is dead after exhausting retries', async () => {
  let calls = 0;
  const client = async () => {
    calls += 1;
    return { status: 500, headers: {} };
  };
  const r = await checkExternalUrl('https://x.test', { client, retry: 1 });
  assert.equal(r.state, 'dead');
  assert.equal(r.status, 500);
  assert.ok(calls > 1, 'should have retried');
});

test('checkExternalUrl: HEAD 405 falls back to GET', async () => {
  const client = async (url, opts) =>
    opts.method === 'HEAD' ? { status: 405, headers: {} } : { status: 200, headers: {} };
  const r = await checkExternalUrl('https://x.test', { client, retry: 0 });
  assert.equal(r.state, 'ok');
  assert.equal(r.status, 200);
});

test('checkExternalUrl: redirect chain within cap resolves ok', async () => {
  const client = async (url) => {
    if (url === 'https://a.test/') return { status: 200, headers: {} };
    return { status: 301, headers: { location: 'https://a.test/' } };
  };
  const r = await checkExternalUrl('https://start.test', { client, maxRedirects: 5, retry: 0 });
  assert.equal(r.state, 'ok');
  assert.equal(r.status, 200);
});

test('checkExternalUrl: exceeding the redirect cap is dead (and terminates)', async () => {
  const client = async () => ({ status: 301, headers: { location: 'https://loop.test/next' } });
  const r = await checkExternalUrl('https://loop.test', { client, maxRedirects: 3, retry: 0 });
  assert.equal(r.state, 'dead');
  assert.match(r.note, /redirect/);
});

test('checkExternalUrl: an aborted/timed-out request is dead', async () => {
  const client = async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    throw err;
  };
  const r = await checkExternalUrl('https://x.test', { client, retry: 0 });
  assert.equal(r.state, 'dead');
  assert.equal(r.note, 'timeout');
});

test('checkExternalUrl: 403 is a reachable warning, not a failure', async () => {
  const client = async () => ({ status: 403, headers: {} });
  const r = await checkExternalUrl('https://x.test', { client, retry: 0 });
  assert.equal(r.state, 'warn');
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------
// local checking — via injected fs
// ---------------------------------------------------------------------------

const fileStat = { isDirectory: () => false, isFile: () => true };
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

test('checkLocal: an existing file with no anchor is ok', async () => {
  const fs = { stat: async () => fileStat, readFile: async () => '# Heading' };
  const r = await checkLocal('/x/file.md', null, { fs });
  assert.equal(r.state, 'ok');
});

test('checkLocal: a missing file is dead', async () => {
  const fs = { stat: async () => { throw enoent(); }, readFile: async () => { throw enoent(); } };
  const r = await checkLocal('/x/missing.md', null, { fs });
  assert.equal(r.state, 'dead');
  assert.match(r.note, /not found/);
});

test('checkLocal: a matching anchor is ok', async () => {
  const fs = { stat: async () => fileStat, readFile: async () => '# Installation\n## Setup Guide' };
  const r = await checkLocal('/x/file.md', 'setup-guide', { fs });
  assert.equal(r.state, 'ok');
});

test('checkLocal: a missing anchor is dead', async () => {
  const fs = { stat: async () => fileStat, readFile: async () => '# Installation' };
  const r = await checkLocal('/x/file.md', 'nope', { fs });
  assert.equal(r.state, 'dead');
  assert.match(r.note, /no matching heading/);
});

// ---------------------------------------------------------------------------
// allow/ignore URL patterns
// ---------------------------------------------------------------------------

test('matchesAny: substring and wildcard patterns', () => {
  assert.ok(matchesAny('https://example.com/a', ['example.com']));
  assert.ok(!matchesAny('https://other.test', ['example.com']));
  assert.ok(matchesAny('https://a.test/x', ['*.test/*']));
});

// ---------------------------------------------------------------------------
// full orchestration — fs + network both injected
// ---------------------------------------------------------------------------

test('checkAll: mixes external, local, anchor and skipped links; exit code reflects deads', async () => {
  const root = path.resolve('/proj');
  const readme = path.join(root, 'README.md');
  const exists = path.join(root, 'exists.md');
  const content = [
    '# Title',
    '',
    '[good](https://good.test)',
    '[bad](https://bad.test)',
    '[local](./exists.md)',
    '[missing](./missing.md)',
    '[anchor](#title)',
    '[mail](mailto:a@b.test)',
  ].join('\n');

  const fs = {
    readFile: async (p) => {
      const key = path.resolve(p);
      if (key === readme) return content;
      if (key === exists) return '# Exists';
      throw enoent();
    },
    stat: async (p) => {
      const key = path.resolve(p);
      if (key === readme || key === exists) return fileStat;
      throw enoent();
    },
  };
  const httpClient = async (url) =>
    url.includes('good') ? { status: 200, headers: {} } : { status: 404, headers: {} };

  const { results, summary } = await checkAll([readme], {
    fs,
    httpClient,
    retry: 0,
    concurrency: 4,
  });

  const state = (url) => results.find((r) => r.url === url)?.state;
  assert.equal(state('https://good.test'), 'ok');
  assert.equal(state('https://bad.test'), 'dead');
  assert.equal(state('./exists.md'), 'ok');
  assert.equal(state('./missing.md'), 'dead');
  assert.equal(state('#title'), 'ok');
  assert.equal(state('mailto:a@b.test'), 'skipped');

  assert.equal(summary.dead, 2);
  assert.equal(summary.external, 2);
  assert.equal(computeExitCode(results), 1);
});

test('checkAll: with external checking disabled, URLs are skipped (no client calls)', async () => {
  const root = path.resolve('/proj2');
  const readme = path.join(root, 'README.md');
  const fs = {
    readFile: async () => '# T\n\n[x](https://any.test)',
    stat: async () => fileStat,
  };
  let called = false;
  const httpClient = async () => {
    called = true;
    return { status: 200, headers: {} };
  };
  const { results } = await checkAll([readme], { fs, httpClient, external: false });
  assert.equal(called, false);
  assert.equal(results.find((r) => r.url === 'https://any.test').state, 'skipped');
});
