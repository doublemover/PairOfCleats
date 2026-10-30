#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runRepoBuild } from '../../../tools/workspace/build.js';

const repo = { repoId: 'fixture', repoRootCanonical: process.cwd() };
for (const failure of [new Error('spawn ENOENT'), Object.assign(new Error('startup failed'), {
  result: { exitCode: null, signal: 'SIGTERM', stderr: 'recorded child error' }
})]) {
  const record = await runRepoBuild({ repo, buildArgs: [] }, { resolveEnv: async () => ({}),
    spawn: async () => { throw failure; } });
  assert.equal(record.status, 'failed', 'thrown spawn failures become structured diagnostics');
  assert.equal(record.exitCode, null, 'an unavailable exit status never becomes zero');
  assert.match(record.error, /spawn ENOENT|recorded child error/);
}

console.log('workspace build spawn throw contract test passed');
