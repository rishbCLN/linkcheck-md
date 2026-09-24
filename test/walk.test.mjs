import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  globToRegExp,
  isIgnored,
  isMarkdownFile,
  hasMagic,
  walk,
} from '../src/walk.mjs';

test('globToRegExp: ** crosses directories, * stays within a segment', () => {
  const deep = globToRegExp('docs/**/*.md');
  assert.ok(deep.test('docs/a.md'));
  assert.ok(deep.test('docs/guide/intro.md'));
  assert.ok(!deep.test('docs/guide/intro.markdown'));

  const flat = globToRegExp('*.md');
  assert.ok(flat.test('README.md'));
  assert.ok(!flat.test('docs/README.md'));
});

test('isMarkdownFile: only .md / .markdown', () => {
  assert.ok(isMarkdownFile('a.md'));
  assert.ok(isMarkdownFile('A.MARKDOWN'));
  assert.ok(!isMarkdownFile('a.txt'));
  assert.ok(!isMarkdownFile('a'));
});

test('hasMagic: detects glob characters', () => {
  assert.ok(hasMagic('a/*.md'));
  assert.ok(hasMagic('a/**/b'));
  assert.ok(!hasMagic('a/b.md'));
});

test('isIgnored: a bare name matches that directory anywhere', () => {
  assert.ok(isIgnored('node_modules/x.md', ['node_modules']));
  assert.ok(isIgnored('a/node_modules/b.md', ['node_modules']));
  assert.ok(!isIgnored('src/a.md', ['node_modules']));
  assert.ok(isIgnored('vendor/lib/a.md', ['vendor/**']));
  assert.ok(isIgnored('CHANGELOG.md', ['CHANGELOG.md']));
});

// A fake filesystem so walking is deterministic and cross-platform.
function makeFakeFs(rootRel) {
  const root = path.resolve(rootRel);
  const dirs = {
    [root]: ['README.md', 'docs', 'node_modules', 'notes.txt'],
    [path.join(root, 'docs')]: ['a.md', 'b.markdown', 'img'],
    [path.join(root, 'docs', 'img')]: ['logo.png'],
    [path.join(root, 'node_modules')]: ['dep.md'],
  };
  const dirSet = new Set(Object.keys(dirs));
  const fs = {
    readdir: async (p) => {
      const key = path.resolve(p);
      if (dirs[key]) return dirs[key];
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    stat: async (p) => {
      const key = path.resolve(p);
      const isDir = dirSet.has(key);
      return { isDirectory: () => isDir, isFile: () => !isDir };
    },
  };
  return { root, fs };
}

test('walk: recurses for markdown, skips node_modules and non-markdown', async () => {
  const { root, fs } = makeFakeFs('/proj');
  const files = await walk(['.'], { fs, cwd: root });
  assert.deepEqual(
    files,
    [
      path.join(root, 'README.md'),
      path.join(root, 'docs', 'a.md'),
      path.join(root, 'docs', 'b.markdown'),
    ].sort(),
  );
});

test('walk: a glob narrows to matching files only', async () => {
  const { root, fs } = makeFakeFs('/proj');
  const files = await walk(['docs/**/*.md'], { fs, cwd: root });
  assert.deepEqual(files, [path.join(root, 'docs', 'a.md')]);
});
