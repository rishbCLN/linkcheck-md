import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, slugifyHeadings } from '../src/slug.mjs';

test('slugify: spaces become hyphens, lowercased', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify: punctuation is stripped (not hyphenated)', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('What? Why!'), 'what-why');
});

test('slugify: leading/trailing whitespace trimmed, runs collapsed', () => {
  assert.equal(slugify('  Trim   Me  '), 'trim-me');
});

test('slugify: underscores and hyphens are kept', () => {
  assert.equal(slugify('snake_case-kept'), 'snake_case-kept');
});

test('slugify: unicode letters are preserved, emoji dropped', () => {
  assert.equal(slugify('Café ☕ Corner'), 'café-corner');
});

test('slugifyHeadings: duplicates get -1, -2 in document order', () => {
  assert.deepEqual(
    slugifyHeadings(['Foo', 'Foo', 'Bar', 'Foo']),
    ['foo', 'foo-1', 'bar', 'foo-2'],
  );
});

test('slugifyHeadings: distinct headings are untouched', () => {
  assert.deepEqual(slugifyHeadings(['Install', 'Usage']), ['install', 'usage']);
});
