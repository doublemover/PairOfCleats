const normalizeFlag = (value) => String(value || '').replaceAll('_', '-');
const HEAP_FLAG_NAMES = new Set(['--max-old-space-size', '--max-semi-space-size', '--max-old-space-size-percentage']);
const parsePositiveIntegerMb = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
};

// NODE_OPTIONS uses double quotes and backslash escapes, not shell quoting.
// Single quotes remain literal: Node rejects them around numeric values.
export const parseNodeOptionsArgv = (nodeOptions = process.env.NODE_OPTIONS) => {
  const raw = typeof nodeOptions === 'string' ? nodeOptions.trim() : '';
  const args = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') { quoted = !quoted; continue; }
    if (char === '\\' && quoted && i + 1 < raw.length) { current += raw[++i]; continue; }
    if (/\s/u.test(char) && !quoted) {
      if (current) args.push(current);
      current = '';
    } else current += char;
  }
  if (quoted) return [];
  if (current) args.push(current);
  return args;
};

export const buildWorkerExecArgv = (argv = process.execArgv) => {
  const output = [];
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string' || !arg) continue;
    const name = normalizeFlag(arg.split('=', 1)[0]);
    if (HEAP_FLAG_NAMES.has(name)) {
      if (!arg.includes('=')) i += 1;
      continue;
    }
    output.push(arg);
  }
  return output;
};

// Node parses NODE_OPTIONS first; command-line singleton options win.
export const collectNodeHeapArgv = ({ execArgv = process.execArgv, nodeOptions = process.env.NODE_OPTIONS } = {}) => [
  ...parseNodeOptionsArgv(nodeOptions),
  ...(Array.isArray(execArgv) ? execArgv : [])
];

export const parseMaxOldSpaceSizeMb = (argv, { strategy = 'last' } = {}) => {
  const values = [];
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    if (typeof args[i] !== 'string') continue;
    const arg = normalizeFlag(args[i]);
    let value = null;
    if (arg === '--max-old-space-size') value = parsePositiveIntegerMb(args[++i]);
    else if (arg.startsWith('--max-old-space-size=')) value = parsePositiveIntegerMb(arg.slice(arg.indexOf('=') + 1));
    if (value != null) values.push(value);
  }
  if (!values.length) return null;
  return strategy === 'min' ? Math.min(...values) : values.at(-1);
};

export const resolveNodeHeapSource = ({ execArgv = [], nodeOptions = '' } = {}) => {
  const envArgs = parseNodeOptionsArgv(nodeOptions);
  // Node26 rejects spaced V8 heap options in both sources. The legacy generic
  // argv parser remains permissive for consumers parsing configuration values.
  if (execArgv.some((arg) => normalizeFlag(arg) === '--max-old-space-size')) {
    return { value: null, source: 'invalid', detail: 'process.execArgv' };
  }
  if (envArgs.some((arg) => normalizeFlag(arg) === '--max-old-space-size')) {
    return { value: null, source: 'invalid', detail: 'NODE_OPTIONS' };
  }
  const cli = parseMaxOldSpaceSizeMb(execArgv);
  const env = parseMaxOldSpaceSizeMb(envArgs);
  if (cli != null) return { value: cli, source: 'execArgv', detail: 'process.execArgv' };
  if (env != null) return { value: env, source: 'external-env', detail: 'NODE_OPTIONS' };
  return { value: null, source: 'unknown', detail: null };
};

export const sanitizeNodeStartupOptions = ({ execArgv = [], nodeOptions = '' } = {}) => {
  const allowlisted = (args) => {
    const output = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = normalizeFlag(args[i]);
      const name = arg.split('=', 1)[0];
      if (['--trace-warnings', '--trace-deprecation', '--no-warnings'].includes(arg)) {
        output.push(arg);
        continue;
      }
      if (!HEAP_FLAG_NAMES.has(name)) continue;
      const value = parsePositiveIntegerMb(arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i]);
      if (value != null) output.push(`${name}=${value}`);
    }
    return output.slice(-16);
  };
  return {
    execArgv: allowlisted(Array.isArray(execArgv) ? execArgv : []),
    nodeOptions: allowlisted(parseNodeOptionsArgv(nodeOptions)),
    redacted: true
  };
};
