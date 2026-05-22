#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const workspacePath = path.join(root, 'temp', 'workspace-build-dispatch.jsonc');
const env = applyTestEnv({ syncProcess: false });

const runCli = (args, options = {}) => runNode(
  [binPath, ...args],
  `pairofcleats ${args.join(' ')}`,
  root,
  env,
  {
    stdio: 'pipe',
    allowFailure: options.allowFailure === true
  }
);

const assertWorkspaceBuildHelp = (result, label) => {
  assert.equal(result.status, 0, `${label} should exit successfully`);
  assert.match(result.stderr || '', /Usage: pairofcleats workspace build --workspace <path>/);
};

assertWorkspaceBuildHelp(
  runCli(['workspace', 'build', '--workspace', workspacePath, '--mode', 'code', '--stub-embeddings', '--help']),
  'workspace build dispatch'
);

assertWorkspaceBuildHelp(
  runCli(['index', 'build', '--workspace', workspacePath, '--mode', 'code', '--stub-embeddings', '--help']),
  'index build workspace alias dispatch'
);

const unknownFlag = runCli(
  ['workspace', 'build', '--workspace', workspacePath, '--unknown-workspace-build-flag'],
  { allowFailure: true }
);
assert.notEqual(unknownFlag.status, 0, 'unknown workspace build flags should fail before script dispatch');
assert.match(unknownFlag.stderr || '', /Unknown flag: --unknown-workspace-build-flag/);

const missingMode = runCli(
  ['index', 'build', '--workspace', workspacePath, '--mode', '--help'],
  { allowFailure: true }
);
assert.notEqual(missingMode.status, 0, 'workspace index-build aliases should enforce index-build value flags');
assert.match(missingMode.stderr || '', /Missing value for --mode/);

console.log('workspace build dispatch test passed');
