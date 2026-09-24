#!/usr/bin/env node
// linkcheck — find dead links in your Markdown and docs, locally and in CI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseArgs, HELP } from '../src/args.mjs';
import { walk } from '../src/walk.mjs';
import { checkAll } from '../src/check.mjs';
import { formatHuman, toJson, computeExitCode } from '../src/report.mjs';
import { makeStyler, colorEnabled } from '../src/ui.mjs';

function getVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const EMPTY_SUMMARY = {
  files: 0,
  links: 0,
  ok: 0,
  dead: 0,
  warn: 0,
  skipped: 0,
  external: 0,
  local: 0,
};

async function main(argv) {
  const opts = parseArgs(argv);
  const c = makeStyler(colorEnabled());

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`linkcheck ${getVersion()}\n`);
    return 0;
  }
  if (opts.errors.length) {
    for (const e of opts.errors) process.stderr.write(`${c.red('error:')} ${e}\n`);
    process.stderr.write(`\nRun ${c.cyan('linkcheck --help')} for usage.\n`);
    return 2;
  }

  // 1. Resolve inputs to a concrete list of Markdown files.
  let files;
  try {
    files = await walk(opts.paths, { ignore: opts.ignore });
  } catch (err) {
    process.stderr.write(`${c.red('error:')} scanning files: ${(err && err.message) || err}\n`);
    return 2;
  }

  if (files.length === 0) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, summary: EMPTY_SUMMARY, results: [] }, null, 2)}\n`);
    } else {
      process.stdout.write(`${c.yellow('no Markdown files found')} to check.\n`);
    }
    return 0;
  }

  // 2. Check every link (fs + network are injected inside checkAll's defaults).
  const { results, summary } = await checkAll(files, {
    ignore: opts.ignore,
    allow: opts.allow,
    external: opts.external,
    timeout: opts.timeout,
    concurrency: opts.concurrency,
    retry: opts.retry,
  });

  // 3. Report + exit code.
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(toJson(results, summary), null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(results, summary, c));
  }

  return computeExitCode(results);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
