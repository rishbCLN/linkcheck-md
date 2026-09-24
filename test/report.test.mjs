import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeExitCode, toJson, formatHuman } from '../src/report.mjs';

const RESULTS = [
  { file: 'README.md', line: 3, url: 'https://bad.test', type: 'inline', kind: 'external', state: 'dead', status: 404, note: 'HTTP 404' },
  { file: 'README.md', line: 5, url: './missing.md', type: 'inline', kind: 'relative', state: 'dead', note: 'file not found' },
  { file: 'README.md', line: 7, url: 'https://ok.test', type: 'inline', kind: 'external', state: 'ok', status: 200 },
];
const SUMMARY = { files: 1, links: 3, ok: 1, dead: 2, warn: 0, skipped: 0, external: 2, local: 1 };

test('computeExitCode: 1 when any link is dead', () => {
  assert.equal(computeExitCode(RESULTS), 1);
});

test('computeExitCode: 0 when nothing is dead', () => {
  const clean = [{ file: 'a.md', line: 1, url: 'https://ok.test', kind: 'external', state: 'ok', status: 200 }];
  assert.equal(computeExitCode(clean), 0);
});

test('formatHuman: groups by file, shows line numbers, marks, and a broken count', () => {
  const out = formatHuman(RESULTS, SUMMARY);
  assert.match(out, /scanned 1 file/);
  assert.match(out, /3 links \(2 external, 1 local\)/);
  assert.match(out, /README\.md/);
  assert.match(out, /line 3/);
  assert.match(out, /https:\/\/bad\.test/);
  assert.match(out, /file not found/);
  assert.match(out, /2 broken links found/);
  assert.ok(out.includes('\u2717')); // ✗ mark
});

test('formatHuman: reports success when there are no dead links', () => {
  const clean = [{ file: 'a.md', line: 1, url: 'https://ok.test', kind: 'external', state: 'ok', status: 200 }];
  const summary = { files: 1, links: 1, ok: 1, dead: 0, warn: 0, skipped: 0, external: 1, local: 0 };
  const out = formatHuman(clean, summary);
  assert.match(out, /no broken links found/);
  assert.ok(out.includes('\u2713')); // ✓ mark
});

test('toJson: stable machine-readable shape', () => {
  const j = toJson(RESULTS, SUMMARY);
  assert.equal(j.ok, false);
  assert.equal(j.summary.dead, 2);
  assert.equal(j.results.length, 3);
  assert.deepEqual(j.results[0], {
    file: 'README.md',
    line: 3,
    url: 'https://bad.test',
    type: 'inline',
    kind: 'external',
    state: 'dead',
    status: 404,
    note: 'HTTP 404',
  });
});
