#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import minimist from 'minimist';
import { fileURLToPath } from 'node:url';
import { resolveAnnSetting, resolveBaseline, resolveCompareModels } from '../src/compare/config.js';
import { DEFAULT_MODEL_ID, getIndexDir, getRuntimeConfig, loadUserConfig, resolveNodeOptions, resolveRepoRoot, resolveSqlitePaths } from './dict-utils.js';

const rawArgs = process.argv.slice(2);
const argv = minimist(rawArgs, {
  boolean: ['json', 'build', 'ann', 'no-ann', 'incremental'],
  string: ['models', 'baseline', 'queries', 'out', 'top', 'limit', 'mode', 'repo'],
  default: {
    json: false,
    build: true,
    top: 5,
    limit: 0
  }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const runtimeConfig = getRuntimeConfig(root, userConfig);
const resolvedNodeOptions = resolveNodeOptions(runtimeConfig, process.env.NODE_OPTIONS || '');
const baseEnv = resolvedNodeOptions
  ? { ...process.env, NODE_OPTIONS: resolvedNodeOptions }
  : process.env;
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const configCompare = Array.isArray(userConfig.models?.compare) ? userConfig.models.compare : [];
const defaultModel = userConfig.models?.id || DEFAULT_MODEL_ID;
const models = resolveCompareModels({
  argvModels: argv.models,
  configCompareModels: configCompare,
  defaultModel
});
if (!models.length) {
  console.error('No models specified. Use --models or configure models.compare.');
  process.exit(1);
}
let baseline;
try {
  baseline = resolveBaseline(models, argv.baseline);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const { annEnabled } = resolveAnnSetting({ rawArgs, argv, userConfig });
const buildEnabled = argv.build !== false;

const reportPaths = {
  compareMemory: path.join(root, 'docs', 'model-compare-report.json'),
  compareSqlite: path.join(root, 'docs', 'model-compare-sqlite.json'),
  paritySqlite: path.join(root, 'docs', 'parity-sqlite-ann.json'),
  paritySqliteFts: path.join(root, 'docs', 'parity-sqlite-fts-ann.json'),
  combined: path.join(root, 'docs', 'combined-summary.json')
};

/**
 * Run a node script and exit on failure.
 * @param {string[]} args
 * @param {string} label
 * @returns {void}
 */
function runNode(args, label) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root, env: baseEnv });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

/**
 * Resolve the best index directory for a mode.
 * @param {'code'|'prose'} mode
 * @returns {string}
 */
function resolveIndexDir(mode) {
  const cached = getIndexDir(root, mode, userConfig);
  const cachedMeta = path.join(cached, 'chunk_meta.json');
  if (fs.existsSync(cachedMeta)) return cached;
  const local = path.join(root, `index-${mode}`);
  const localMeta = path.join(local, 'chunk_meta.json');
  if (fs.existsSync(localMeta)) return local;
  return cached;
}

/**
 * Ensure index and SQLite artifacts exist for parity runs.
 * @returns {void}
 */
function ensureParityIndexes() {
  const codeMeta = path.join(resolveIndexDir('code'), 'chunk_meta.json');
  const proseMeta = path.join(resolveIndexDir('prose'), 'chunk_meta.json');
  if (!fs.existsSync(codeMeta) || !fs.existsSync(proseMeta)) {
    if (!buildEnabled) {
      console.error('Index missing for parity. Re-run with --build.');
      process.exit(1);
    }
    const args = [path.join(scriptRoot, 'build_index.js'), '--repo', root];
    if (argv.incremental) args.push('--incremental');
    runNode(args, 'build index');
  }

  const sqlitePaths = resolveSqlitePaths(root, userConfig);
  const sqliteMissing = !fs.existsSync(sqlitePaths.codePath) || !fs.existsSync(sqlitePaths.prosePath);
  if (sqliteMissing) {
    if (!buildEnabled) {
      console.error('SQLite index missing for parity. Re-run with --build.');
      process.exit(1);
    }
    const args = [path.join(scriptRoot, 'tools', 'build-sqlite-index.js'), '--repo', root];
    if (argv.incremental) args.push('--incremental');
    runNode(args, 'build sqlite index');
  }
}

/**
 * Build args for model comparison runs.
 * @param {{backend?:string,outPath:string}} params
 * @returns {string[]}
 */
function buildCompareArgs({ backend, outPath, buildIndex, buildSqlite }) {
  const args = [
    path.join(scriptRoot, 'tools', 'compare-models.js'),
    '--repo',
    root,
    '--models',
    models.join(','),
    '--baseline',
    baseline,
    '--out',
    outPath
  ];
  if (backend) args.push('--backend', backend);
  if (argv.queries) args.push('--queries', argv.queries);
  if (argv.top) args.push('--top', String(argv.top));
  if (argv.limit) args.push('--limit', String(argv.limit));
  if (argv.mode) args.push('--mode', argv.mode);
  if (!annEnabled) args.push('--no-ann');
  if (buildIndex) args.push('--build');
  if (buildSqlite) args.push('--build-sqlite');
  if (argv.incremental) args.push('--incremental');
  return args;
}

/**
 * Build args for parity runs.
 * @param {{backend:string,outPath:string}} params
 * @returns {string[]}
 */
function buildParityArgs({ backend, outPath }) {
  const args = [
    path.join(scriptRoot, 'tests', 'parity.js'),
    '--search',
    path.join(scriptRoot, 'search.js'),
    '--sqlite-backend',
    backend,
    '--write-report',
    '--out',
    outPath
  ];
  if (annEnabled) args.push('--ann');
  else args.push('--no-ann');
  if (argv.queries) args.push('--queries', argv.queries);
  if (argv.top) args.push('--top', String(argv.top));
  if (argv.limit) args.push('--limit', String(argv.limit));
  return args;
}

runNode(
  buildCompareArgs({ outPath: reportPaths.compareMemory, buildIndex: buildEnabled, buildSqlite: false }),
  'compare models (memory)'
);
runNode(
  buildCompareArgs({ outPath: reportPaths.compareSqlite, backend: 'sqlite', buildIndex: false, buildSqlite: buildEnabled }),
  'compare models (sqlite)'
);

ensureParityIndexes();
runNode(buildParityArgs({ backend: 'sqlite', outPath: reportPaths.paritySqlite }), 'parity sqlite');
runNode(buildParityArgs({ backend: 'sqlite-fts', outPath: reportPaths.paritySqliteFts }), 'parity sqlite-fts');

/**
 * Read JSON from disk or return null.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const compareMemory = readJson(reportPaths.compareMemory);
const compareSqlite = readJson(reportPaths.compareSqlite);
const paritySqlite = readJson(reportPaths.paritySqlite);
const paritySqliteFts = readJson(reportPaths.paritySqliteFts);

const combined = {
  generatedAt: new Date().toISOString(),
  repo: {
    root: path.resolve(root)
  },
  settings: {
    models,
    baseline,
    annEnabled,
    topN: Number(argv.top) || 5,
    limit: Number(argv.limit) || 0,
    mode: argv.mode || 'both'
  },
  reports: {
    compare: {
      memory: compareMemory,
      sqlite: compareSqlite
    },
    parity: {
      sqlite: paritySqlite,
      sqliteFts: paritySqliteFts
    }
  },
  summary: {
    compare: {
      memory: compareMemory?.summary || null,
      sqlite: compareSqlite?.summary || null
    },
    parity: {
      sqlite: paritySqlite?.summary || null,
      sqliteFts: paritySqliteFts?.summary || null
    }
  }
};

const outPath = argv.out ? path.resolve(argv.out) : reportPaths.combined;
await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
await fsPromises.writeFile(outPath, JSON.stringify(combined, null, 2));

if (argv.json) {
  console.log(JSON.stringify(combined, null, 2));
} else {
  console.log(`Combined summary written to ${outPath}`);
}
