import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  HELP,
  DEFAULT_TIMEOUT,
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRY,
} from '../src/args.mjs';

test('parseArgs: sensible defaults with no arguments', () => {
  const r = parseArgs([]);
  assert.deepEqual(r.paths, []);
  assert.equal(r.external, true);
  assert.equal(r.timeout, DEFAULT_TIMEOUT);
  assert.equal(r.concurrency, DEFAULT_CONCURRENCY);
  assert.equal(r.retry, DEFAULT_RETRY);
  assert.equal(r.json, false);
  assert.deepEqual(r.errors, []);
});

test('parseArgs: positional paths are collected', () => {
  const r = parseArgs(['README.md', 'docs', 'guide/*.md']);
  assert.deepEqual(r.paths, ['README.md', 'docs', 'guide/*.md']);
});

test('parseArgs: numeric options (space and = forms)', () => {
  const r = parseArgs(['--timeout', '5000', '--concurrency', '4', '--retry', '2']);
  assert.equal(r.timeout, 5000);
  assert.equal(r.concurrency, 4);
  assert.equal(r.retry, 2);
  assert.equal(parseArgs(['--timeout=1234']).timeout, 1234);
});

test('parseArgs: --ignore and --allow accumulate and split on commas', () => {
  const r = parseArgs(['--ignore', 'a,b', '--ignore', 'c', '--allow', 'example.com,foo']);
  assert.deepEqual(r.ignore, ['a', 'b', 'c']);
  assert.deepEqual(r.allow, ['example.com', 'foo']);
});

test('parseArgs: --json toggles JSON output', () => {
  assert.equal(parseArgs(['--json']).json, true);
});

test('parseArgs: --no-external and --offline disable network checks', () => {
  assert.equal(parseArgs(['--no-external']).external, false);
  assert.equal(parseArgs(['--offline']).external, false);
});

test('parseArgs: help and version', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['--version']).version, true);
});

test('parseArgs: unknown option is an error, paths still collected', () => {
  const r = parseArgs(['--bogus', 'README.md']);
  assert.ok(r.errors.some((e) => /unknown option/.test(e)));
  assert.deepEqual(r.paths, ['README.md']);
});

test('parseArgs: invalid numeric value is an error and keeps the default', () => {
  const r = parseArgs(['--timeout', 'abc']);
  assert.equal(r.errors.length, 1);
  assert.equal(r.timeout, DEFAULT_TIMEOUT);
});

test('parseArgs: a value-taking option at the end reports a missing value', () => {
  const r = parseArgs(['--concurrency']);
  assert.ok(r.errors.some((e) => /requires a value/.test(e)));
});

test('parseArgs: --retry 0 is allowed', () => {
  const r = parseArgs(['--retry', '0']);
  assert.equal(r.retry, 0);
  assert.deepEqual(r.errors, []);
});

test('HELP mentions the tool and key options', () => {
  assert.match(HELP, /linkcheck/);
  assert.match(HELP, /--no-external/);
  assert.match(HELP, /--json/);
});
