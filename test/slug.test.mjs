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

test('slugify: leading/trailing whitespace trimmed, internal runs NOT collapsed', () => {
  // GitHub replaces each space with a hyphen (it does not collapse runs), so the
  // three interior spaces become three hyphens.
  assert.equal(slugify('  Trim   Me  '), 'trim---me');
});

test('slugify: underscores and hyphens are kept', () => {
  assert.equal(slugify('snake_case-kept'), 'snake_case-kept');
});

test('slugify: unicode letters are preserved, emoji dropped', () => {
  // The dropped emoji sat between two spaces, which GitHub turns into two hyphens.
  assert.equal(slugify('Café ☕ Corner'), 'café--corner');
});

test('slugify: GitHub parity — removed punctuation / repeated spaces are NOT collapsed', () => {
  // Regression: `slugify` used to collapse whitespace runs (/\s+/ -> "-"), which
  // disagreed with GitHub's github-slugger (each space -> a hyphen). That produced
  // false "no matching heading" reports for links to real GitHub anchors.
  assert.equal(slugify('Cats & Dogs'), 'cats--dogs');
  assert.equal(slugify('a  b'), 'a--b');
  assert.equal(slugify('Q & A / FAQ'), 'q--a--faq');
});

test('slugifyHeadings: GitHub-style double hyphen survives de-duplication', () => {
  assert.deepEqual(
    slugifyHeadings(['Cats & Dogs', 'Cats & Dogs']),
    ['cats--dogs', 'cats--dogs-1'],
  );
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
