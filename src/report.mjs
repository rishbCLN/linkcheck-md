// PURE presentation of check results: a human, grouped-by-file summary or a JSON
// document, plus the CI exit-code decision. No I/O — callers write the strings.

const IDENTITY = {
  red: (s) => String(s),
  green: (s) => String(s),
  yellow: (s) => String(s),
  cyan: (s) => String(s),
  dim: (s) => String(s),
  bold: (s) => String(s),
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Exit code intent: 1 if any link is dead, otherwise 0. */
export function computeExitCode(results) {
  return results.some((r) => r.state === 'dead') ? 1 : 0;
}

/** Machine-readable shape for `--json`. */
export function toJson(results, summary) {
  return {
    ok: computeExitCode(results) === 0,
    summary,
    results: results.map((r) => ({
      file: r.file,
      line: r.line,
      url: r.url,
      type: r.type,
      kind: r.kind,
      state: r.state,
      status: r.status,
      note: r.note,
    })),
  };
}

/**
 * Render the human report.
 * @param {Array<object>} results
 * @param {object} summary
 * @param {object} [styler]  a makeStyler() result; defaults to no color
 * @returns {string}
 */
export function formatHuman(results, summary, styler) {
  const c = styler || IDENTITY;
  const lines = [];

  const counts = [`${summary.external} external`, `${summary.local} local`];
  if (summary.skipped) counts.push(`${summary.skipped} skipped`);
  lines.push(
    `${c.dim('scanned')} ${c.bold(String(summary.files))} ${plural(summary.files, 'file').replace(/^\d+ /, '')} ` +
      `${c.dim('\u00b7')} ${plural(summary.links, 'link')} (${counts.join(', ')})`,
  );

  const problems = results.filter((r) => r.state === 'dead' || r.state === 'warn');
  const byFile = new Map();
  for (const r of problems) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }

  if (byFile.size) {
    lines.push('');
    for (const [file, items] of byFile) {
      lines.push(c.bold(file));
      const maxUrl = Math.max(...items.map((r) => String(r.url).length));
      const maxLine = Math.max(...items.map((r) => String(r.line).length));
      for (const r of items) {
        const mark = r.state === 'dead' ? c.red('\u2717') : c.yellow('\u26a0');
        const loc = c.dim(`line ${String(r.line).padStart(maxLine)}`);
        const url = String(r.url).padEnd(maxUrl);
        const note = r.note ? c.dim(`(${r.note})`) : '';
        lines.push(`  ${mark} ${loc}  ${url}  ${note}`.trimEnd());
      }
    }
  }

  lines.push('');
  if (summary.dead === 0) {
    const warn = summary.warn ? c.dim(` (${plural(summary.warn, 'warning')})`) : '';
    lines.push(`${c.green('\u2713')} ${c.green('no broken links found')}${warn}`);
  } else {
    const warn = summary.warn ? c.dim(`, ${plural(summary.warn, 'warning')}`) : '';
    lines.push(`${c.red('\u2717')} ${c.red(`${plural(summary.dead, 'broken link')} found`)}${warn}`);
  }

  return `${lines.join('\n')}\n`;
}
