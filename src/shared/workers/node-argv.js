const HEAP_FLAG_NAMES = new Set([
  '--max-old-space-size',
  '--max-semi-space-size'
]);

const isHeapFlagWithInlineValue = (arg) => (
  typeof arg === 'string'
  && (
    arg.startsWith('--max-old-space-size=')
    || arg.startsWith('--max-semi-space-size=')
  )
);

const parsePositiveIntegerMb = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
};

export const buildWorkerExecArgv = (argv = process.execArgv) => {
  const output = [];
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string' || !arg) continue;
    if (HEAP_FLAG_NAMES.has(arg)) {
      i += 1;
      continue;
    }
    if (isHeapFlagWithInlineValue(arg)) continue;
    output.push(arg);
  }
  return output;
};

export const parseNodeOptionsArgv = (nodeOptions = process.env.NODE_OPTIONS) => {
  const raw = typeof nodeOptions === 'string' ? nodeOptions.trim() : '';
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
};

export const collectNodeHeapArgv = ({
  execArgv = process.execArgv,
  nodeOptions = process.env.NODE_OPTIONS
} = {}) => [
  ...(Array.isArray(execArgv) ? execArgv : []),
  ...parseNodeOptionsArgv(nodeOptions)
];

export const parseMaxOldSpaceSizeMb = (argv, { strategy = 'last' } = {}) => {
  const values = [];
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') continue;
    if (arg === '--max-old-space-size' && i + 1 < args.length) {
      const value = parsePositiveIntegerMb(args[i + 1]);
      if (value != null) values.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--max-old-space-size=')) {
      const value = parsePositiveIntegerMb(arg.split('=', 2)[1]);
      if (value != null) values.push(value);
    }
  }
  if (!values.length) return null;
  return strategy === 'min'
    ? Math.min(...values)
    : values[values.length - 1];
};
