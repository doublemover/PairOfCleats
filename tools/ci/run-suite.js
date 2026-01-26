#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { spawnSubprocess } from '../../src/shared/subprocess.js';
import { getRuntimeConfig, loadUserConfig, resolveRuntimeEnv } from '../dict-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_JUNIT = path.join(ROOT, 'artifacts', 'junit.xml');
const DEFAULT_DIAGNOSTICS = path.join(ROOT, '.diagnostics');
const DEFAULT_LOG_DIR = path.join(ROOT, 'tests', '.logs');
const DEFAULT_CACHE_ROOT = path.join(ROOT, '.ci-cache', 'pairofcleats');

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const parseArgs = () => {
  const parser = yargs(hideBin(process.argv))
    .scriptName('pairofcleats ci-suite')
    .option('mode', { type: 'string', default: 'pr', choices: ['pr', 'nightly'] })
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
  const baseEnv = buildSuiteEnv(mode);
  const userConfig = loadUserConfig(ROOT);
  const runtimeConfig = getRuntimeConfig(ROOT, userConfig);
  const env = resolveRuntimeEnv(runtimeConfig, baseEnv);

  const diagnosticsDir = path.resolve(argv.diagnostics);
  const junitPath = path.resolve(argv.junit);
  const logDir = path.resolve(argv['log-dir']);
  const capabilityJson = path.join(diagnosticsDir, 'capabilities.json');

  if (!argv['dry-run']) {
    await ensureDir(path.dirname(junitPath));
    await ensureDir(diagnosticsDir);
    await ensureDir(logDir);
    if (env.PAIROFCLEATS_CACHE_ROOT) {
      await ensureDir(env.PAIROFCLEATS_CACHE_ROOT);
    }
  }

  const steps = [
    { label: 'Lint', command: npmBin, args: ['run', 'lint'] },
    { label: 'Config budget', command: npmBin, args: ['run', 'config:budget'] },
    { label: 'Env usage guardrail', command: npmBin, args: ['run', 'env:check'] },
    {
      label: 'CI test lane',
      command: process.execPath,
      args: [
        'tests/run.js',
        '--lane',
        'ci',
        '--exclude',
        'services/api/',
        ...(mode === 'nightly' ? ['--lane', 'storage', '--lane', 'perf'] : []),
        '--junit',
        junitPath,
        '--log-dir',
        logDir
      ]
    },
    ...(mode === 'nightly'
      ? [{
        label: 'Script coverage',
        command: process.execPath,
        args: ['tests/script-coverage.js', '--log-dir', logDir]
      }]
      : []),
    {
      label: 'Capability gate',
      command: process.execPath,
      args: ['tools/ci/capability-gate.js', '--mode', mode, '--json', capabilityJson]
    }
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
