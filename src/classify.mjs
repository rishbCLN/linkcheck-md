// Pure classification of a link target into what kind of check it needs.
//
//   external      http(s):// (and protocol-relative //host) -> network check
//   relative      a path on disk (optionally with an #anchor) -> filesystem check
//   anchor        #fragment only -> check against the current file's headings
//   skip          mailto:/tel:/javascript:/data: ... -> never fetched, reported as skipped
//
// Kept pure (no I/O) so it can be exhaustively unit-tested.

/** Schemes we deliberately never touch. */
export const SKIPPED_SCHEMES = new Set([
  'mailto', 'tel', 'sms', 'javascript', 'data', 'ftp', 'file', 'irc', 'news', 'about',
]);

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Classify a raw link target.
 * @param {string|null|undefined} raw
 * @returns {{ kind: 'external'|'relative'|'anchor'|'skip',
 *             url?: string, scheme?: string, path?: string, anchor?: string|null, reason?: string }}
 */
export function classifyLink(raw) {
  if (raw == null) return { kind: 'skip', reason: 'empty' };
  const url = String(raw).trim();
  if (url === '') return { kind: 'skip', reason: 'empty' };

  // Pure fragment: an anchor into the current document.
  if (url.startsWith('#')) {
    return { kind: 'anchor', anchor: safeDecode(url.slice(1)) };
  }

  // Anything with an explicit scheme.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') {
      return { kind: 'external', url, scheme };
    }
    return { kind: 'skip', reason: 'scheme', scheme };
  }

  // Protocol-relative URL -> treat as external over https.
  if (url.startsWith('//')) {
    return { kind: 'external', url: `https:${url}`, scheme: 'https' };
  }

  // Otherwise it's a relative path, possibly with a query and/or fragment.
  const hashIdx = url.indexOf('#');
  let path = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const anchor = hashIdx === -1 ? null : safeDecode(url.slice(hashIdx + 1));
  const qIdx = path.indexOf('?');
  if (qIdx !== -1) path = path.slice(0, qIdx);
  return { kind: 'relative', path, anchor };
}
