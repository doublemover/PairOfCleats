#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { createCli } from '../src/shared/cli.js';
import { BENCH_OPTIONS, mergeCliOptions, validateBenchArgs } from '../src/shared/cli-options.js';
import { resolveToolRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'bench-language-matrix',
  options: mergeCliOptions(
    BENCH_OPTIONS,
    {
      tier: { type: 'string', default: 'typical' },
      backend: { type: 'string' },
      backends: { type: 'string' },
      'ann-modes': { type: 'string' },
      'fts-profiles': { type: 'string' },
      config: { type: 'string' },
      root: { type: 'string' },
      'cache-root': { type: 'string' },
      'cache-suffix': { type: 'string' },
      results: { type: 'string' },
      'log-dir': { type: 'string' },
      'out-dir': { type: 'string' },
      language: { type: 'string' },
      languages: { type: 'string' },
      repos: { type: 'string' },
      only: { type: 'string' },
      'fts-weights': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'fail-fast': { type: 'boolean', default: false },
      'lock-mode': { type: 'string' },
      'lock-wait-ms': { type: 'number' },
      'lock-stale-ms': { type: 'number' }
    }
  )
}).parse();
validateBenchArgs(argv);

const scriptRoot = resolveToolRoot();
const benchScript = path.join(scriptRoot, 'tools', 'bench-language-repos.js');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultsRoot = path.resolve(argv.results || path.join(scriptRoot, 'benchmarks', 'results'));
const runRoot = path.resolve(argv['out-dir'] || path.join(resultsRoot, 'matrix', timestamp));
const logRoot = path.resolve(argv['log-dir'] || path.join(runRoot, 'logs'));
const outRoot = path.join(runRoot, 'runs');

const ALL_BACKENDS = ['sqlite-fts', 'sqlite', 'memory'];
const DEFAULT_ANN_MODES = ['auto', 'on', 'off'];
const DEFAULT_FTS_PROFILES = ['balanced', 'headline', 'name'];

const parseList = (value) => {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const normalizeBackend = (raw) => {
  const value = String(raw || '').toLowerCase();
  if (value === 'fts') return 'sqlite-fts';
  return value;
};

const resolveBackends = () => {
  const raw = argv.backends || argv.backend || '';
  const list = parseList(raw).map(normalizeBackend).filter(Boolean);
  if (!list.length || list.includes('all')) return ALL_BACKENDS.slice();
  return list;
};

const resolveAnnModes = () => {
  const list = parseList(argv['ann-modes']).map((entry) => entry.toLowerCase());
  return list.length ? list : DEFAULT_ANN_MODES.slice();
};

const resolveFtsProfiles = () => {
  const list = parseList(argv['fts-profiles']).map((entry) => entry.toLowerCase());
  return list.length ? list : DEFAULT_FTS_PROFILES.slice();
};

const toSafeName = (value) => String(value || '')
  .replace(/[^a-z0-9-_]+/gi, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

const buildConfigs = () => {
  const configs = [];
  const backends = resolveBackends();
  const annModes = resolveAnnModes();
  const ftsProfiles = resolveFtsProfiles();
  for (const backend of backends) {
    const usesFts = backend === 'sqlite-fts' || backend === 'fts';
    const profiles = usesFts ? ftsProfiles : [null];
    for (const annMode of annModes) {
      for (const profile of profiles) {
        const idParts = [backend, annMode];
        if (profile) idParts.push(profile);
        const id = toSafeName(idParts.join('-'));
        configs.push({
          id,
          backend,
          annMode,
          ftsProfile: profile
        });
      }
    }
  }
  return configs;
};

const appendArgs = (args, flag, value) => {
  if (value === undefined || value === null || value === '') return;
  args.push(flag, String(value));
};

const configToArgs = (config, outFile, logFile) => {
  const args = [benchScript];
  const tierArg = argv.tier || 'typical';
  appendArgs(args, '--tier', tierArg);
  appendArgs(args, '--backend', config.backend);
  appendArgs(args, '--out', outFile);
  appendArgs(args, '--log', logFile);

  if (config.annMode === 'on') args.push('--ann');
  if (config.annMode === 'off') args.push('--no-ann');
  if (config.ftsProfile) appendArgs(args, '--fts-profile', config.ftsProfile);

  if (argv.build) args.push('--build');
  if (argv['build-index']) args.push('--build-index');
  if (argv['build-sqlite']) args.push('--build-sqlite');
  if (argv.incremental) args.push('--incremental');
  if (argv['stub-embeddings']) args.push('--stub-embeddings');
  if (argv['real-embeddings']) args.push('--real-embeddings');
  if (argv['dry-run']) args.push('--dry-run');

  appendArgs(args, '--config', argv.config);
  appendArgs(args, '--root', argv.root);
  appendArgs(args, '--cache-root', argv['cache-root']);
  appendArgs(args, '--cache-suffix', argv['cache-suffix']);
  appendArgs(args, '--results', argv.results);
  appendArgs(args, '--index-profile', argv['index-profile']);
  if (argv['no-index-profile']) args.push('--no-index-profile');
  appendArgs(args, '--language', argv.language);
  appendArgs(args, '--languages', argv.languages);
  appendArgs(args, '--repos', argv.repos);
  appendArgs(args, '--only', argv.only);
  appendArgs(args, '--queries', argv.queries);
  appendArgs(args, '--top', argv.top);
  appendArgs(args, '--limit', argv.limit);
  appendArgs(args, '--bm25-k1', argv['bm25-k1']);
  appendArgs(args, '--bm25-b', argv['bm25-b']);
  appendArgs(args, '--fts-weights', argv['fts-weights']);
  appendArgs(args, '--threads', argv.threads);
  appendArgs(args, '--heap-mb', argv['heap-mb']);
  appendArgs(args, '--lock-mode', argv['lock-mode']);
  appendArgs(args, '--lock-wait-ms', argv['lock-wait-ms']);
  appendArgs(args, '--lock-stale-ms', argv['lock-stale-ms']);

  if (argv['no-index-profile']) args.push('--no-index-profile');
  return args;
};

async function main() {
  await fsPromises.mkdir(logRoot, { recursive: true });
  await fsPromises.mkdir(outRoot, { recursive: true });

  const configs = buildConfigs();
  if (!configs.length) {
    console.error('No benchmark configurations resolved.');
    process.exit(1);
  }

  const results = [];
  for (const config of configs) {
    const label = `${config.backend}/${config.annMode}${config.ftsProfile ? `/${config.ftsProfile}` : ''}`;
    const outFile = path.join(outRoot, `${config.id}.json`);
    const logFile = path.join(logRoot, `${config.id}.log`);
    const args = configToArgs(config, outFile, logFile);

    console.log(`\n[bench-matrix] ${label}`);
    console.log(`node ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`);

    if (argv['dry-run']) {
      results.push({ ...config, outFile, logFile, status: 'dry-run' });
      continue;
    }

    try {
      const child = execa(process.execPath, args, { stdio: 'inherit' });
      await child;
      results.push({ ...config, outFile, logFile, status: 'ok' });
    } catch (err) {
      results.push({
        ...config,
        outFile,
        logFile,
        status: 'failed',
        exitCode: err?.exitCode ?? null,
        error: err?.message || String(err)
      });
      if (argv['fail-fast']) break;
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    runRoot,
    outRoot,
    logRoot,
    tier: argv.tier,
    results
  };
  const summaryPath = path.join(runRoot, 'matrix.json');
  await fsPromises.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n[bench-matrix] Summary written to ${summaryPath}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
