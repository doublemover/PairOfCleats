#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { createToolDisplayLogger } from '../shared/cli-display.js';
import { runSubprocessOrExit } from '../shared/cli-utils.js';
import { readRepoGitState } from '../shared/git-state.js';
import { bootstrapRuntime, resolveToolRoot } from '../shared/dict-utils.js';
import { exportCiArtifactBundle } from './artifact-bundle.js';

const argv = createCli({
  scriptName: 'ci-build',
  options: {
    'skip-build': { type: 'boolean', default: false },
    'skip-sqlite': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    out: { type: 'string' },
    repo: { type: 'string' },
    progress: { type: 'string', default: 'auto' },
    verbose: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false }
  }
}).parse();

const { display, logger } = createToolDisplayLogger({ argv, stream: process.stderr });
const totalSteps = (argv['skip-build'] ? 0 : 1) + (argv['skip-sqlite'] ? 0 : 1) + 1;
let stepIndex = 0;
const updateProgress = (message) => {
  display.showProgress('CI', stepIndex, totalSteps, { stage: 'ci', message });
};

const { repoRoot: root, userConfig, runtimeEnv: baseEnv } = bootstrapRuntime(argv.repo);
const scriptRoot = resolveToolRoot();
const outDir = argv.out ? path.resolve(argv.out) : path.join(root, 'ci-artifacts');

/**
 * Run a command and exit on failure.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} label
 */
function run(cmd, args, label) {
  runSubprocessOrExit({
    command: cmd,
    args,
    label,
    stdio: 'inherit',
    env: baseEnv,
    logError: logger.error,
    onFailure: () => display.close()
  });
}

if (!argv['skip-build']) {
  const childProgress = argv.verbose ? (argv.progress || 'auto') : 'off';
  const args = [
    path.join(scriptRoot, 'build_index.js'),
    '--repo',
    root,
    '--progress',
    childProgress
  ];
  if (argv.incremental) args.push('--incremental');
  if (argv.verbose) args.push('--verbose');
  if (argv.quiet) args.push('--quiet');
  updateProgress('build index');
  run(process.execPath, args, 'build index');
  stepIndex += 1;
}

if (!argv['skip-sqlite']) {
  const childProgress = argv.verbose ? (argv.progress || 'auto') : 'off';
  const args = [
    path.join(scriptRoot, 'build_index.js'),
    '--stage',
    '4',
    '--repo',
    root,
    '--progress',
    childProgress
  ];
  if (argv.incremental) args.push('--incremental');
  if (argv.verbose) args.push('--verbose');
  if (argv.quiet) args.push('--quiet');
  updateProgress('build sqlite');
  run(process.execPath, args, 'build sqlite index');
  stepIndex += 1;
}

updateProgress('pack artifacts');
try {
  await exportCiArtifactBundle({ root, userConfig, outDir,
    gitState: await readRepoGitState(root), includeSqlite: !argv['skip-sqlite'] });
} catch (error) {
  logger.error(error?.message || error);
  display.close();
  process.exitCode = 1;
  throw error;
}

stepIndex += 1;
display.showProgress('CI', stepIndex, totalSteps, { stage: 'ci', message: 'complete' });
logger.log(`CI artifacts written to ${outDir}`);
display.close();
