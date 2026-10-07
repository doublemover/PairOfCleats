#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

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
    assert.equal(result.status, 1, `${command.join(' ')} must reject before its workflow starts: ${result.stderr}`);
    assert.match(result.stderr + result.stdout, /Unknown argument: poc-unknown-option/);
    assert.doesNotMatch(result.stderr + result.stdout, /npm (?:error|install)|missing cargo|event:chunk/);
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
