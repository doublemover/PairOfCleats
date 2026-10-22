/** CLI option owners shared with internal typed operator forms. */
export const INDEX_VALIDATE_OPTIONS = {
  json: { type: 'boolean', default: false },
  repo: { type: 'string' },
  mode: { type: 'string' },
  'index-root': { type: 'string' },
  strict: { type: 'boolean', describe: 'Validate strict contracts (default unless --non-strict).' },
  'non-strict': { type: 'boolean', default: false }
};

export const INDEX_STATS_OPTIONS = {
  repo: { type: 'string' },
  'index-dir': { type: 'string' },
  mode: { type: 'string' },
  json: { type: 'boolean', default: false },
  verify: { type: 'boolean', default: false }
};

export const INDEX_REPORT_OPTIONS = {
  json: { type: 'boolean', default: false },
  all: { type: 'boolean', default: false },
  repo: { type: 'string' },
  runtime: { type: 'boolean', default: false },
  'index-root': { type: 'string' },
  build: { type: 'string' },
  attempt: { type: 'string' },
  mode: { type: 'string' },
  explain: { type: 'string' },
  'redact-paths': { type: 'boolean', default: false }
};

export const SNAPSHOT_COMMANDS = {
  create: { command: 'create', description: 'Create a pointer snapshot from the current validated build', options: {
    repo: { type: 'string' }, modes: { type: 'string' }, id: { type: 'string' },
    label: { type: 'string' }, tags: { type: 'string' }, tag: { type: 'array', string: true },
    'retention-tier': { type: 'string' }, 'wait-ms': { type: 'number', default: 0 },
    'max-pointer-snapshots': { type: 'number' }, json: { type: 'boolean', default: false }
  } },
  freeze: { command: 'freeze <snapshotId>', description: 'Freeze a pointer snapshot into immutable frozen roots',
    positional: { snapshotId: { type: 'string', demandOption: true } }, options: {
      repo: { type: 'string' }, modes: { type: 'string' }, method: { type: 'string', default: 'copy' },
      verify: { type: 'boolean', default: true }, 'include-sqlite': { type: 'string', default: 'auto' },
      'include-lmdb': { type: 'boolean', default: false }, 'retention-tier': { type: 'string' },
      'wait-ms': { type: 'number', default: 0 }, json: { type: 'boolean', default: false }
    } },
  gc: { command: 'gc', description: 'Garbage-collect old snapshots with protected-tag safety', options: {
    repo: { type: 'string' }, 'keep-pointer': { type: 'number' }, 'keep-frozen': { type: 'number' },
    'keep-tags': { type: 'string' }, 'max-age-days': { type: 'number' }, 'staging-max-age-hours': { type: 'number' },
    'wait-ms': { type: 'number', default: 0 }, 'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }
  } },
  prune: { command: 'prune', description: 'Prune old untagged pointer snapshots', options: {
    repo: { type: 'string' }, 'max-pointer-snapshots': { type: 'number' },
    'wait-ms': { type: 'number', default: 0 }, 'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }
  } },
  list: { command: 'list', description: 'List snapshots', options: {
    repo: { type: 'string' }, json: { type: 'boolean', default: false }
  } },
  show: { command: 'show <snapshotId>', description: 'Show one snapshot',
    positional: { snapshotId: { type: 'string', demandOption: true } }, options: {
      repo: { type: 'string' }, json: { type: 'boolean', default: false }
    } },
  remove: { command: ['rm <snapshotId>', 'remove <snapshotId>'], description: 'Remove a snapshot',
    positional: { snapshotId: { type: 'string', demandOption: true } }, options: {
      repo: { type: 'string' }, force: { type: 'boolean', default: false },
      'wait-ms': { type: 'number', default: 0 }, json: { type: 'boolean', default: false }
    } }
};

export const WORKSPACE_BUILD_OPTIONS = {
  workspace: { type: 'string', describe: 'Workspace config path (.jsonc)' },
  concurrency: { type: 'number', default: 2, describe: 'Max concurrent repo builds' },
  strict: { type: 'boolean', default: false, describe: 'Stop scheduling new repos after first failure' },
  'include-disabled': { type: 'boolean', default: false, describe: 'Include disabled repos from the workspace' },
  json: { type: 'boolean', default: false, describe: 'Emit JSON summary' }
};
export const MAX_WORKSPACE_BUILD_CONCURRENCY = 32;

export const resolveWorkspaceBuildConcurrency = value => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --concurrency value: ${value}`);
  return Math.min(MAX_WORKSPACE_BUILD_CONCURRENCY, Math.max(1, Math.floor(parsed)));
};

export const assertIndexValidationFlags = argv => {
  if (argv.strict && argv['non-strict']) throw new Error('Choose either --strict or --non-strict, not both.');
};

export const configureSnapshotCommand = (command, name) => {
  const spec = SNAPSHOT_COMMANDS[name];
  for (const [key, definition] of Object.entries(spec.positional || {})) command.positional(key, definition);
  return command.options(spec.options);
};
