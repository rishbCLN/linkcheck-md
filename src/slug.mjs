// Pure GitHub-style heading -> anchor slug conversion.
//
// GitHub builds an anchor for every heading: lowercase the text, drop anything
// that isn't a letter, number, space, hyphen or underscore, then turn each space
// into a hyphen (consecutive spaces become consecutive hyphens, exactly like
// GitHub). Duplicate headings get a `-1`, `-2`, ... suffix
// in document order. All of this is deterministic and side-effect free, so it is
// trivially unit-testable.

/**
 * Convert a single heading string into its GitHub-compatible slug.
 * Unicode letters/numbers are preserved (matching GitHub), emoji/punctuation dropped.
 * @param {string} heading
 * @returns {string}
 */
export function slugify(heading) {
  return String(heading)
    .trim()
    .toLowerCase()
    // strip punctuation/symbols but keep letters, numbers, spaces, hyphen, underscore
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    // turn each whitespace character into a hyphen — GitHub does NOT collapse
    // runs, so "a & b" -> "a--b" (the removed "&" leaves two spaces -> two hyphens)
    .replace(/\s/g, '-');
}

/**
 * Slugify an ordered list of headings, appending `-1`, `-2`, ... to duplicates
 * exactly the way GitHub does.
 * @param {string[]} headings
 * @returns {string[]}
 */
export function slugifyHeadings(headings) {
  const counts = new Map();
  const slugs = [];
  for (const heading of headings) {
    const base = slugify(heading);
    if (counts.has(base)) {
      const n = counts.get(base) + 1;
      counts.set(base, n);
      slugs.push(`${base}-${n}`);
    } else {
      counts.set(base, 0);
      slugs.push(base);
    }
  }
  return slugs;
}
