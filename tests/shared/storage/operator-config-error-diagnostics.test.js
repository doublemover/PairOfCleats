import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const temporary = await makeTempDir('poc-storage-operator-');
try {
  const repo = path.join(temporary, 'broken-repo');
  const home = path.join(temporary, 'home');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), '{invalid-json');
  const env = applyTestEnv({ syncProcess: false });
  const invoke = args => runNode(['tools/storage/cli.js', ...args], 'storage operator contract', process.cwd(), env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  const before = await fs.readdir(temporary, { recursive: true });
  const doctor = invoke(['doctor', '--repo', repo, '--home', home, '--json']);
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  const diagnosis = JSON.parse(doctor.stdout);
  assert.equal(diagnosis.mutationPerformed, false);
  assert.equal(diagnosis.configurationErrors.some(error => error.source === 'repository-config'), true);
  const cleanup = invoke(['cleanup-plan', '--repo', repo, '--home', home, '--json']);
  assert.equal(cleanup.status, 1);
  assert.equal(JSON.parse(cleanup.stdout).blocked[0].reason, 'configuration-incomplete-no-storage-authority-granted');
  const unknown = invoke(['doctor', '--unknown-storage-mutation']);
  assert.notEqual(unknown.status, 0, 'direct invocation must reject undeclared options');
  const extra = invoke(['doctor', 'cleanup-apply']);
  assert.notEqual(extra.status, 0, 'one action cannot smuggle another positional action');
  assert.deepEqual(await fs.readdir(temporary, { recursive: true }), before, 'diagnostics and rejected actions cannot create home, lease or cleanup paths');
} finally { await rmDirRecursive(temporary); }
console.log('storage operator config-error diagnostics passed');
