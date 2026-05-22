#!/usr/bin/env node
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { repoRoot } from '../../helpers/root.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const ROOT = repoRoot();

const runSnippet = (envOverrides) => runNode(
  [
    '--input-type=module',
    '-e',
    "import('./tests/helpers/require-or-skip.js').then(({ requireOrSkip }) => { requireOrSkip({ capability: 'missing-cap', reason: 'missing-capability', requiredInCi: true }); });"
  ],
  'required optional dependency policy snippet',
  ROOT,
  applyTestEnv({ syncProcess: false, extraEnv: envOverrides }),
  { stdio: 'pipe', allowFailure: true }
);

const optionalResult = runNode(
  [
    '--input-type=module',
    '-e',
    "import('./tests/helpers/require-or-skip.js').then(({ requireOrSkip }) => { requireOrSkip({ capability: 'missing-cap', reason: 'missing-capability' }); });"
  ],
  'optional dependency policy snippet',
  ROOT,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe', allowFailure: true }
);

if (optionalResult.status !== 77) {
  console.error('optional deps policy failed: expected skip exit code');
  process.exit(1);
}

const requiredResult = runSnippet({ CI: 'true' });
if (requiredResult.status === 0 || requiredResult.status === 77) {
  console.error('optional deps policy failed: required capability should fail in CI');
  process.exit(1);
}

console.log('optional deps policy test passed');
