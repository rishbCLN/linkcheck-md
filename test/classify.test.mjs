import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink, SKIPPED_SCHEMES } from '../src/classify.mjs';

test('classifyLink: https and http are external', () => {
  assert.deepEqual(classifyLink('https://example.com'), {
    kind: 'external',
    url: 'https://example.com',
    scheme: 'https',
  });
  assert.deepEqual(classifyLink('http://example.com/a'), {
    kind: 'external',
    url: 'http://example.com/a',
    scheme: 'http',
  });
});

test('classifyLink: bare fragment is an anchor', () => {
  assert.deepEqual(classifyLink('#getting-started'), { kind: 'anchor', anchor: 'getting-started' });
});

test('classifyLink: relative path with no anchor', () => {
  assert.deepEqual(classifyLink('./docs/setup.md'), {
    kind: 'relative',
    path: './docs/setup.md',
    anchor: null,
  });
});

test('classifyLink: relative path splits off the anchor', () => {
  assert.deepEqual(classifyLink('../guide/intro.md#install'), {
    kind: 'relative',
    path: '../guide/intro.md',
    anchor: 'install',
  });
});

test('classifyLink: query strings are stripped from the file part', () => {
  assert.deepEqual(classifyLink('page.md?v=2#top'), {
    kind: 'relative',
    path: 'page.md',
    anchor: 'top',
  });
});

test('classifyLink: mailto/tel are skipped with their scheme noted', () => {
  assert.deepEqual(classifyLink('mailto:hi@example.com'), {
    kind: 'skip',
    reason: 'scheme',
    scheme: 'mailto',
  });
  assert.equal(classifyLink('tel:+15550100').kind, 'skip');
  assert.ok(SKIPPED_SCHEMES.has('tel'));
});

test('classifyLink: protocol-relative URL becomes external https', () => {
  assert.deepEqual(classifyLink('//cdn.example.com/lib.js'), {
    kind: 'external',
    url: 'https://cdn.example.com/lib.js',
    scheme: 'https',
  });
});

test('classifyLink: empty/whitespace is skipped', () => {
  assert.equal(classifyLink('').kind, 'skip');
  assert.equal(classifyLink('   ').kind, 'skip');
  assert.equal(classifyLink(null).kind, 'skip');
});
