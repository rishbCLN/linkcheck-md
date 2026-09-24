// Zero-dependency argument parsing. Kept pure so it is fully unit-testable.

export const DEFAULT_TIMEOUT = 8000;
export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_RETRY = 1;

export const HELP = `linkcheck — find dead links in your Markdown and docs

Usage:
  linkcheck [paths...] [options]

Arguments:
  paths                    Files, directories, or globs to scan
                           (default: current directory, *.md and *.markdown)

Options:
      --ignore <globs>     Comma-separated globs to skip (repeatable)
      --allow <patterns>   URL substrings/globs to treat as OK and skip (repeatable)
      --no-external        Only check local files and anchors (no network)
      --offline            Alias for --no-external
      --timeout <ms>       Per-request timeout (default: ${DEFAULT_TIMEOUT})
      --concurrency <n>    Max parallel requests (default: ${DEFAULT_CONCURRENCY})
      --retry <n>          Retries for transient failures (default: ${DEFAULT_RETRY})
      --json               Output a JSON report
  -h, --help               Show this help
  -v, --version            Show the version

Examples:
  linkcheck                        # scan ./ for *.md, check local + external links
  linkcheck README.md docs         # scan a file and a directory
  linkcheck "docs/**/*.md" --json  # machine-readable report for CI
  linkcheck . --no-external        # local files + anchors only (no network)
  linkcheck . --ignore "vendor/**,CHANGELOG.md"

Exit codes:
  0  no broken links    1  broken links found    2  usage error
`;

function parsePositiveInt(name, raw, { allowZero = false } = {}) {
  const n = Number(raw);
  const ok = Number.isInteger(n) && (allowZero ? n >= 0 : n > 0);
  if (!ok) {
    return { value: null, error: `${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer (got "${raw}")` };
  }
  return { value: n, error: null };
}

/**
 * Parse argv (excluding node + script).
 * @param {string[]} argv
 * @returns {{ paths: string[], ignore: string[], allow: string[], external: boolean,
 *             timeout: number, concurrency: number, retry: number, json: boolean,
 *             help: boolean, version: boolean, errors: string[] }}
 */
export function parseArgs(argv) {
  const result = {
    paths: [],
    ignore: [],
    allow: [],
    external: true,
    timeout: DEFAULT_TIMEOUT,
    concurrency: DEFAULT_CONCURRENCY,
    retry: DEFAULT_RETRY,
    json: false,
    help: false,
    version: false,
    errors: [],
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inlineVal = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      inlineVal = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const takeValue = (name) => {
      if (inlineVal != null) return inlineVal;
      const next = argv[i + 1];
      // Never swallow the following token when it looks like another flag
      // (starts with '-'); a lone '-' remains a usable value (e.g. stdin).
      if (next != null && !(next.startsWith('-') && next !== '-')) return argv[++i];
      result.errors.push(`option ${name} requires a value`);
      return null;
    };
    const addList = (target, value) => {
      if (value == null) return;
      for (const part of value.split(',')) {
        const t = part.trim();
        if (t) target.push(t);
      }
    };

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '--json':
        result.json = true;
        break;
      case '--external':
        result.external = true;
        break;
      case '--no-external':
      case '--offline':
        result.external = false;
        break;
      case '--ignore':
        addList(result.ignore, takeValue('--ignore'));
        break;
      case '--allow':
        addList(result.allow, takeValue('--allow'));
        break;
      case '--timeout': {
        const v = takeValue('--timeout');
        if (v != null) {
          const { value, error } = parsePositiveInt('--timeout', v);
          if (error) result.errors.push(error);
          else result.timeout = value;
        }
        break;
      }
      case '--concurrency': {
        const v = takeValue('--concurrency');
        if (v != null) {
          const { value, error } = parsePositiveInt('--concurrency', v);
          if (error) result.errors.push(error);
          else result.concurrency = value;
        }
        break;
      }
      case '--retry': {
        const v = takeValue('--retry');
        if (v != null) {
          const { value, error } = parsePositiveInt('--retry', v, { allowZero: true });
          if (error) result.errors.push(error);
          else result.retry = value;
        }
        break;
      }
      default:
        if (arg.length > 1 && arg.startsWith('-')) {
          result.errors.push(`unknown option: ${arg}`);
        } else {
          result.paths.push(arg);
        }
    }
  }

  return result;
}
