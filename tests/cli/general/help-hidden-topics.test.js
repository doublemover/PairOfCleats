#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const env = applyTestEnv({ syncProcess: false });

const runCli = (args) => runNode(
  [binPath, ...args],
  `pairofcleats ${args.join(' ')}`,
  root,
  env,
  { stdio: 'pipe' }
);

for (const topic of ['dispatch', 'bench']) {
  const result = runCli(['help', topic]);
  assert.equal(result.status, 0, `expected hidden help topic ${topic} to return guidance instead of failing`);
  const output = getCombinedOutput(result);
  assert.match(output, new RegExp(`Help topic: ${topic}`), `expected topic header for ${topic}`);
  assert.doesNotMatch(output, /Unknown help topic/i, `expected ${topic} to avoid the unknown-topic error path`);
  assert.match(output, /help --all/i, `expected ${topic} help to guide users toward --all`);
}

console.log('CLI hidden help topics test passed');
