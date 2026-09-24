// PURE Markdown parsing: pull out every link (with its 1-based line number) while
// carefully ignoring anything inside fenced code, indented code, or inline code
// spans. Also exposes heading extraction used for anchor validation.
//
// No I/O here — the input is a string and the output is plain data, so the fiddly
// Markdown rules can be exhaustively unit-tested.

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const ATX_RE = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const SETEXT_RE = /^ {0,3}(=+|-+)\s*$/;
const INDENT_RE = /^( {4,}|\t)/;
// A reference definition:  [id]: url "optional title"
const DEF_RE = /^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;

const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const INLINE_LINK_RE = /\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REF_IMAGE_RE = /!\[([^\]]*)\]\[([^\]]*)\]/g;
const REF_LINK_RE = /\[([^\]]+)\]\[([^\]]*)\]/g;
const AUTOLINK_RE = /<((?:[a-zA-Z][a-zA-Z0-9+.-]*):[^>\s]+)>/g;
const SHORTCUT_RE = /\[([^\]]+)\]/g;

/**
 * Blank out HTML comments (`<!-- ... -->`, possibly multi-line) by replacing every
 * non-newline character with a space. Line numbers and line lengths are preserved, so
 * links hidden inside comments are never extracted.
 */
export function stripHtmlComments(markdown) {
  return String(markdown).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Strip surrounding <> from an inline URL and trim it. */
function cleanUrl(u) {
  let s = String(u).trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return s;
}

/**
 * Replace inline code spans with equal-length runs of spaces so that links inside
 * them are never matched, while keeping every other character (and column) intact.
 */
export function maskInlineCode(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let j = i;
      while (line[j] === '`') j++;
      const runLen = j - i;
      // find a closing backtick run of the exact same length
      let k = j;
      let found = -1;
      while (k < line.length) {
        if (line[k] === '`') {
          let m = k;
          while (line[m] === '`') m++;
          if (m - k === runLen) { found = k; break; }
          k = m;
        } else {
          k++;
        }
      }
      if (found !== -1) {
        const end = found + runLen;
        out += ' '.repeat(end - i);
        i = end;
      } else {
        out += line.slice(i, j);
        i = j;
      }
    } else {
      out += line[i];
      i++;
    }
  }
  return out;
}

function scanLine(line, lineNo, out, pendingRefs) {
  let s = maskInlineCode(line);
  const consume = (re, handler) => {
    re.lastIndex = 0;
    s = s.replace(re, (...args) => {
      handler(args);
      return ' '.repeat(args[0].length);
    });
  };

  // Order matters: images before links, explicit refs before shortcut refs.
  consume(INLINE_IMAGE_RE, (a) => out.push({ url: cleanUrl(a[2]), line: lineNo, type: 'image' }));
  consume(INLINE_LINK_RE, (a) => out.push({ url: cleanUrl(a[2]), line: lineNo, type: 'inline' }));
  consume(REF_IMAGE_RE, (a) => pendingRefs.push({ id: a[2] || a[1], line: lineNo, type: 'image' }));
  consume(REF_LINK_RE, (a) => pendingRefs.push({ id: a[2] || a[1], line: lineNo, type: 'reference' }));
  consume(AUTOLINK_RE, (a) => out.push({ url: a[1], line: lineNo, type: 'autolink' }));
  consume(SHORTCUT_RE, (a) => pendingRefs.push({ id: a[1], line: lineNo, type: 'reference', shortcut: true }));
}

function isFenceClose(fence, fenceChar, fenceLen) {
  return (
    fence[2][0] === fenceChar &&
    fence[2].length >= fenceLen &&
    /^[`~]*\s*$/.test(fence[2] + fence[3])
  );
}

/**
 * Extract every link from a Markdown document.
 * Reference links are resolved against their definitions; explicit references with
 * no definition are returned with `undefinedReference: true` and `url: null`.
 * @param {string} markdown
 * @returns {Array<{ url: string|null, line: number, type: string, id?: string, undefinedReference?: boolean }>}
 */
export function extractLinks(markdown) {
  const lines = stripHtmlComments(markdown).split(/\r?\n/);
  const out = [];
  const pendingRefs = [];
  const defs = new Map();

  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inIndent = false;
  let prevBlank = true;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNo = idx + 1;
    const isBlank = /^\s*$/.test(line);
    const fence = FENCE_RE.exec(line);

    if (inFence) {
      if (fence && isFenceClose(fence, fenceChar, fenceLen)) inFence = false;
      prevBlank = isBlank;
      continue;
    }
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      inFence = true;
      fenceChar = fence[2][0];
      fenceLen = fence[2].length;
      prevBlank = false;
      continue;
    }

    if (inIndent) {
      if (isBlank) { prevBlank = true; continue; }
      if (INDENT_RE.test(line)) { prevBlank = false; continue; }
      inIndent = false;
    } else if (prevBlank && INDENT_RE.test(line)) {
      inIndent = true;
      prevBlank = false;
      continue;
    }

    const defMatch = DEF_RE.exec(line);
    if (defMatch) {
      const id = defMatch[1].trim().toLowerCase();
      if (!defs.has(id)) defs.set(id, { url: cleanUrl(defMatch[2]), line: lineNo });
    } else {
      scanLine(line, lineNo, out, pendingRefs);
    }
    prevBlank = isBlank;
  }

  for (const ref of pendingRefs) {
    const def = defs.get(String(ref.id).trim().toLowerCase());
    if (def) {
      out.push({ url: def.url, line: ref.line, type: ref.type });
    } else if (!ref.shortcut) {
      out.push({ url: null, line: ref.line, type: ref.type, id: ref.id, undefinedReference: true });
    }
    // an unresolved shortcut like `[see note]` is just prose — ignore it
  }

  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * Extract heading texts (ATX + Setext), skipping fenced code. Order is preserved so
 * slug de-duplication matches the source document.
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractHeadings(markdown) {
  const lines = stripHtmlComments(markdown).split(/\r?\n/);
  const headings = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const fence = FENCE_RE.exec(line);
    if (inFence) {
      if (fence && isFenceClose(fence, fenceChar, fenceLen)) inFence = false;
      continue;
    }
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      inFence = true;
      fenceChar = fence[2][0];
      fenceLen = fence[2].length;
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      headings.push(atx[2].trim());
      continue;
    }
    const next = lines[idx + 1];
    if (
      line.trim() !== '' &&
      !/^ {0,3}#/.test(line) &&
      next !== undefined &&
      SETEXT_RE.test(next) &&
      /[\p{L}\p{N}]/u.test(line)
    ) {
      headings.push(line.trim());
    }
  }
  return headings;
}

/**
 * Collect explicit HTML anchor targets (`<a name="x">` and any `id="x"`) so links to
 * hand-authored anchors are not reported as broken.
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractHtmlAnchors(markdown) {
  const text = stripHtmlComments(markdown);
  const anchors = [];
  for (const m of text.matchAll(/<a\s+[^>]*name\s*=\s*["']([^"']+)["']/gi)) anchors.push(m[1]);
  for (const m of text.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) anchors.push(m[1]);
  return anchors;
}
