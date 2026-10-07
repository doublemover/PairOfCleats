#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { formatCommandFailure } from '../../helpers/command-failure.js';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-unknown-workflow-options-'));
const cache = path.join(temp, 'cache');
const events = path.join(temp, 'events');
const env = applyTestEnv({ syncProcess: false, cacheRoot: cache, embeddings: 'off',
  extraEnv: { PAIROFCLEATS_TUI_EVENT_LOG_DIR: events } });
const cli = (args) => runNode([path.join(root, 'bin', 'pairofcleats.js'), ...args],
  args.join(' '), temp, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
const commands = [
  ['setup'], ['bootstrap'], ['dispatch', 'list'], ['dispatch', 'describe'],
  ['index', 'validate'], ['ingest', 'ctags'], ['ingest', 'gtags'],
  ['ingest', 'lsif'], ['ingest', 'scip'], ['report', 'parity'], ['report', 'summary'],
  ['bench', 'micro'], ['sqlite', 'compact'], ['tui', 'build'], ['tui', 'install'],
  ['tui', 'supervisor']
];
try {
  for (const command of commands) {
    const result = cli([...command, '--poc-unknown-option']);
    assert.equal(result.status, 1, formatCommandFailure({
      label: `${command.join(' ')} must reject before its workflow starts`,
      result
    }));
    assert.match(result.stderr + result.stdout, /Unknown argument: poc-unknown-option/);
    assert.doesNotMatch(result.stderr + result.stdout, /npm (?:error|install)|missing cargo|event:chunk/);
  }
  const runtimeGuardPath = path.join(temp, 'guard-bench-runtime.mjs');
  const guardedModules = [
    'src/integrations/core/index.js',
    'tools/bench/micro/index-build.js',
    'tools/bench/micro/search.js'
  ].map((relativePath) => pathToFileURL(path.join(root, relativePath)).href);
  await fs.writeFile(runtimeGuardPath, `
import { registerHooks } from 'node:module';
const guardedModules = new Set(${JSON.stringify(guardedModules)});
registerHooks({
  load(url, context, nextLoad) {
    if (guardedModules.has(url)) throw new Error('BENCH_WORKFLOW_RUNTIME_LOADED');
    return nextLoad(url, context);
  }
});
`);
  const guardedEnv = {
    ...env,
    NODE_OPTIONS: [env.NODE_OPTIONS, `--import=${pathToFileURL(runtimeGuardPath).href}`].filter(Boolean).join(' ')
  };
  for (const entrypoint of [
    [path.join(root, 'bin', 'pairofcleats.js'), 'bench', 'micro'],
    [path.join(root, 'tools', 'bench', 'micro', 'run.js')]
  ]) {
    const guardedRun = (args) => runNode([...entrypoint, ...args], 'bench parser runtime boundary', temp,
      guardedEnv, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
    const invalid = guardedRun(['--poc-unknown-option']);
    assert.equal(invalid.status, 1, formatCommandFailure({ label: 'invalid bench options', result: invalid }));
    assert.match(invalid.stderr, /Unknown argument: poc-unknown-option/);
    assert.doesNotMatch(invalid.stderr + invalid.stdout, /BENCH_WORKFLOW_RUNTIME_LOADED/);
    const help = guardedRun(['--help']);
    assert.equal(help.status, 0, formatCommandFailure({ label: 'bench help', result: help }));
    assert.match(help.stdout, /--components/);
    assert.doesNotMatch(help.stderr + help.stdout, /BENCH_WORKFLOW_RUNTIME_LOADED/);
    const valid = guardedRun(['--no-build', '--components=', '--json']);
    assert.equal(valid.status, 1, formatCommandFailure({ label: 'bench runtime guard control', result: valid }));
    assert.match(valid.stderr, /BENCH_WORKFLOW_RUNTIME_LOADED/, 'valid options must reach the guarded runtime');
    assert.doesNotMatch(valid.stderr, /Unknown argument/);
  }
  await assert.rejects(fs.access(cache), 'invalid options must not create cache or report output');
  await assert.rejects(fs.access(events), 'invalid supervisor options must not create event logs');
  const supervisorHelp = cli(['tui', 'supervisor', '--help']);
  assert.equal(supervisorHelp.status, 0);
  assert.match(supervisorHelp.stdout, /poc\.tui@1/);
  assert.doesNotMatch(supervisorHelp.stdout, /"event":"hello"/);
  const nonStrict = cli(['index', 'validate', '--repo', temp, '--non-strict', '--json']);
  assert.equal(nonStrict.status, 1, 'an empty fixture still has no valid index');
  assert.doesNotMatch(nonStrict.stderr, /Choose either --strict or --non-strict/);
  assert.equal(typeof JSON.parse(nonStrict.stdout), 'object');
  const conflict = cli(['index', 'validate', '--repo', temp, '--strict', '--non-strict']);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /Choose either --strict or --non-strict/);
  const strictSearch = cli(['search', '--strict-dispatch', '--poc-unknown-option']);
  assert.equal(strictSearch.status, 1);
  assert.match(strictSearch.stderr + strictSearch.stdout, /Unknown flag: --poc-unknown-option/);
  const closedInput = cli(['setup', '--root', temp]);
  assert.equal(closedInput.status, 1, 'closed setup stdin must fail clearly rather than exit 13');
  assert.match(closedInput.stderr, /Setup input closed.*--non-interactive/);
  assert.doesNotMatch(closedInput.stderr, /unsettled top-level await/);
  console.log('Unknown workflow options fail before output/installation; search retains its explicit strict-dispatch contract.');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
