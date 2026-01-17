#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';

const hasPython = () => {
  const candidates = ['python', 'python3'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-c', 'import sys; sys.stdout.write("ok")'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'ok') return true;
  }
  return false;
};

if (!hasPython()) {
  console.log('Skipping Python metadata checks (python not available).');
  process.exit(0);
}

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample'
});

const payload = runSearch({
  fixtureRoot,
  env,
  query: 'message',
  mode: 'code',
  args: ['--backend', 'memory']
});
const hit = (payload.code || []).find(
  (entry) => entry.file === 'src/sample.py' && String(entry.name || '').endsWith('message')
);
if (!hit) {
  console.error('Python metadata check failed: missing sample.py message chunk.');
  process.exit(1);
}
const signature = hit.docmeta?.signature || '';
const decorators = hit.docmeta?.decorators || [];
if (!signature.includes('def message')) {
  console.error('Python metadata check failed: missing signature metadata.');
  process.exit(1);
}
if (!decorators.includes('staticmethod')) {
  console.error('Python metadata check failed: missing decorator metadata.');
  process.exit(1);
}

console.log('Python fixture metadata ok.');
