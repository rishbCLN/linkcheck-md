// Find Markdown files under the given paths/globs. The glob + ignore matching is a
// tiny PURE engine (no `globby`), and the directory reads go through an injected fs
// so the whole thing is testable without a real tree.
import { promises as realFs } from 'node:fs';
import path from 'node:path';

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
/** Always skipped, even without --ignore, so we never crawl deps or git internals. */
export const DEFAULT_IGNORES = ['node_modules', '.git'];

/** Does a path look like it contains glob magic? */
export function hasMagic(str) {
  return /[*?[\]{}]/.test(str);
}

/** Is this a Markdown file we should scan? */
export function isMarkdownFile(file, extensions = MARKDOWN_EXTENSIONS) {
  const ext = path.extname(file).toLowerCase();
  return extensions.includes(ext);
}

/**
 * Convert a glob into an anchored RegExp. Supports `*` (within a segment), `**`
 * (across segments), and `?`. Everything else is matched literally.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  const g = String(glob).replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // **/  ->  zero or more leading dirs
        } else {
          re += '.*'; // **  ->  anything, including slashes
        }
      } else {
        re += '[^/]*'; // *  ->  anything within a single segment
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Normalize a path for matching: forward slashes, no leading `./`. */
export function normalizeForMatch(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Should `relPath` be ignored given a list of ignore globs? A bare name like
 * `node_modules` matches that directory anywhere in the tree.
 * @param {string} relPath  path relative to the scan root (any separators)
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isIgnored(relPath, patterns = []) {
  const p = normalizeForMatch(relPath);
  for (const raw of patterns) {
    const pat = normalizeForMatch(String(raw).trim()).replace(/\/+$/, '');
    if (!pat) continue;
    const candidates = pat.includes('/')
      ? [pat, `${pat}/**`]
      : [pat, `${pat}/**`, `**/${pat}`, `**/${pat}/**`];
    for (const c of candidates) {
      if (globToRegExp(c).test(p)) return true;
    }
  }
  return false;
}

/** Longest leading portion of a glob that has no magic — used as the walk root. */
function globBase(glob) {
  const parts = normalizeForMatch(glob).split('/');
  const base = [];
  for (const part of parts) {
    if (hasMagic(part)) break;
    base.push(part);
  }
  return base.join('/');
}

async function statSafe(fs, target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function walkDir(fs, dir, { cwd, ignore, extensions, onFile }) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = path.join(dir, name);
    const rel = normalizeForMatch(path.relative(cwd, abs));
    if (isIgnored(rel, ignore)) continue;
    const st = await statSafe(fs, abs);
    if (!st) continue;
    if (st.isDirectory()) {
      await walkDir(fs, abs, { cwd, ignore, extensions, onFile });
    } else if (isMarkdownFile(abs, extensions) && st.isFile()) {
      onFile(abs, rel);
    }
  }
}

/**
 * Resolve inputs (files, directories, or globs) into a sorted, de-duplicated list of
 * absolute Markdown file paths.
 * @param {string[]} inputs
 * @param {{ fs?: any, cwd?: string, ignore?: string[], extensions?: string[] }} [opts]
 * @returns {Promise<string[]>}
 */
export async function walk(inputs, opts = {}) {
  const fs = opts.fs || realFs;
  const cwd = opts.cwd || process.cwd();
  const extensions = opts.extensions || MARKDOWN_EXTENSIONS;
  const ignore = [...DEFAULT_IGNORES, ...(opts.ignore || [])];
  const found = new Set();
  const onFile = (abs) => found.add(abs);

  const list = inputs && inputs.length ? inputs : ['.'];
  for (const input of list) {
    if (hasMagic(input)) {
      const base = globBase(input);
      const baseAbs = path.resolve(cwd, base || '.');
      const re = globToRegExp(normalizeForMatch(input));
      await walkDir(fs, baseAbs, {
        cwd,
        ignore,
        extensions,
        onFile: (abs, rel) => {
          if (re.test(rel)) found.add(abs);
        },
      });
      continue;
    }

    const abs = path.resolve(cwd, input);
    const st = await statSafe(fs, abs);
    if (!st) continue;
    if (st.isDirectory()) {
      await walkDir(fs, abs, { cwd, ignore, extensions, onFile });
    } else if (st.isFile() && isMarkdownFile(abs, extensions)) {
      const rel = normalizeForMatch(path.relative(cwd, abs));
      if (!isIgnored(rel, opts.ignore || [])) found.add(abs);
    }
  }

  return [...found].sort();
}
