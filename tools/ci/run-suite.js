#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from '../shared/dict-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DIAGNOSTICS = path.join(ROOT, '.diagnostics');
const DEFAULT_LOG_DIR = path.join(ROOT, '.testLogs');
const DEFAULT_JUNIT = path.join(DEFAULT_LOG_DIR, 'junit.xml');
const DEFAULT_CACHE_ROOT = path.join(ROOT, '.ci-cache', 'pairofcleats');

const npmCommand = process.platform === 'win32' ? 'cmd' : 'npm';
const npmPrefix = process.platform === 'win32' ? ['/c', 'npm'] : [];

const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats ci-suite')
    .option('mode', { type: 'string', default: 'ci', choices: ['ci', 'nightly'] })
    .option('lane', { type: 'string', default: '' })
    .option('skip-prechecks', { type: 'boolean', default: false })
    .option('dry-run', { type: 'boolean', default: false })
    .option('junit', { type: 'string', default: DEFAULT_JUNIT })
    .option('diagnostics', { type: 'string', default: DEFAULT_DIAGNOSTICS })
    .option('log-dir', { type: 'string', default: DEFAULT_LOG_DIR })
    .help()
    .alias('h', 'help')
    .strictOptions();
  return parser.parse();
};

const isCi = () => Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

const withDefaults = (env, key, value) => {
  if (env[key] === undefined || env[key] === '') env[key] = value;
};

const buildSuiteEnv = (mode) => {
  const env = { ...process.env };
  withDefaults(env, 'PAIROFCLEATS_TESTING', '1');
  withDefaults(env, 'PAIROFCLEATS_EMBEDDINGS', 'stub');
  withDefaults(env, 'PAIROFCLEATS_WORKER_POOL', 'off');
  withDefaults(env, 'PAIROFCLEATS_THREADS', '1');
  withDefaults(env, 'PAIROFCLEATS_BUNDLE_THREADS', '1');

  if (!env.PAIROFCLEATS_CACHE_ROOT && isCi()) {
    env.PAIROFCLEATS_CACHE_ROOT = DEFAULT_CACHE_ROOT;
  }

  env.PAIROFCLEATS_SUITE_MODE = mode;
  return env;
};

const renderCommand = (command, args) => [command, ...args].join(' ');
const SCRIPT_COVERAGE_GROUPS = Object.freeze([
  'core',
  'storage',
  'indexing',
  'language',
  'benchmarks',
  'search',
  'embeddings',
  'services',
  'fixtures',
  'tools'
]);

const runStep = async (step, env, dryRun) => {
  const commandLine = renderCommand(step.command, step.args);
  if (dryRun) {
    console.error(`[dry-run] ${step.label}: ${commandLine}`);
    return;
  }
  console.error(`\n==> ${step.label}`);
  const result = await spawnSubprocess(step.command, step.args, {
    stdio: 'inherit',
    cwd: step.cwd || ROOT,
    env,
    detached: false,
    rejectOnNonZeroExit: false
  });
  if (result.exitCode !== 0) {
    throw new Error(`step failed (${step.label}): exit ${result.exitCode ?? 'unknown'}`);
  }
};

const ensureDir = async (dir) => {
  await fsPromises.mkdir(dir, { recursive: true });
};

const main = async () => {
  const argv = parseArgs();
  const mode = argv.mode;
  const baseLane = argv.lane || (mode === 'nightly' ? 'ci' : 'ci-lite');
  const baseEnv = buildSuiteEnv(mode);
  const userConfig = loadUserConfig(ROOT);
  const runtimeConfig = getRuntimeConfig(ROOT, userConfig);
  const env = resolveRuntimeEnv(runtimeConfig, baseEnv);

  const diagnosticsDir = path.resolve(argv.diagnostics);
  const junitPath = path.resolve(argv.junit);
  const logDir = path.resolve(argv['log-dir']);
  if (!env.PAIROFCLEATS_TEST_LOG_DIR) {
    env.PAIROFCLEATS_TEST_LOG_DIR = logDir;
  }
  const capabilityJson = path.join(diagnosticsDir, 'capabilities.json');

  if (!argv['dry-run']) {
    await ensureDir(path.dirname(junitPath));
    await ensureDir(diagnosticsDir);
    await ensureDir(logDir);
    if (env.PAIROFCLEATS_CACHE_ROOT) {
      await ensureDir(env.PAIROFCLEATS_CACHE_ROOT);
    }
  }

  if (env.PAIROFCLEATS_CACHE_ROOT && !argv['dry-run']) {
    const cacheRootPath = path.resolve(env.PAIROFCLEATS_CACHE_ROOT);
    const cachePayload = {
      cacheRoot: cacheRootPath,
      repoRoot: path.join(cacheRootPath, 'repos')
    };
    await fsPromises.writeFile(
      path.join(diagnosticsDir, 'cache-root.json'),
      `${JSON.stringify(cachePayload, null, 2)}\n`
    );
    console.error(`Cache root: ${cacheRootPath}`);
  }

  const precheckSteps = argv['skip-prechecks']
    ? []
    : [
      { label: 'Lint', command: npmCommand, args: [...npmPrefix, 'run', 'lint'] },
      { label: 'Config budget', command: npmCommand, args: [...npmPrefix, 'run', 'config:budget'] },
      { label: 'Env usage guardrail', command: npmCommand, args: [...npmPrefix, 'run', 'env:check'] }
    ];

  const steps = [
    ...precheckSteps,
    {
      label: 'Capability gate',
      command: process.execPath,
      args: ['tools/ci/capability-gate.js', '--mode', mode, '--json', capabilityJson]
    },
    {
      label: 'CI test lane',
      command: process.execPath,
      args: [
        'tests/run.js',
        '--lane',
        baseLane,
        '--exclude',
        'services/api/',
        ...(mode === 'nightly' ? ['--lane', 'storage', '--lane', 'perf'] : []),
        '--timeout-ms',
        '600000',
        '--allow-timeouts',
        '--junit',
        junitPath,
        '--log-dir',
        logDir
      ]
    },
    ...(mode === 'nightly'
      ? [{
        label: 'Bench harness (sweet16-ci)',
        command: process.execPath,
        args: [
          'tools/bench/bench-runner.js',
          '--suite',
          'sweet16-ci',
          '--timeout-ms',
          '600000',
          '--json',
          path.join(logDir, 'bench-sweet16.json'),
          '--quiet'
        ]
      }]
      : []),
    ...(mode === 'nightly'
      ? SCRIPT_COVERAGE_GROUPS.map((group) => ({
        label: `Script coverage (${group})`,
        command: process.execPath,
        args: [`tests/tooling/script-coverage/script-coverage-${group}.test.js`]
      }))
      : [])
  ];

  console.error(`Suite mode: ${mode}`);
  console.error(`Diagnostics: ${diagnosticsDir}`);
  console.error(`JUnit: ${junitPath}`);
  console.error(`Logs: ${logDir}`);

  for (const step of steps) {
    await runStep(step, env, argv['dry-run']);
  }
};

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
