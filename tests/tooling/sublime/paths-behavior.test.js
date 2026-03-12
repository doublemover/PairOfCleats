import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');
const checker = path.join(root, 'tools', 'tooling', 'python-check.js');
const helper = path.join(root, 'tests', 'helpers', 'sublime', 'paths_behavior.py');

const pythonPolicy = spawnSync(process.execPath, [checker, '--json'], {
  cwd: root,
  encoding: 'utf8',
});

if (pythonPolicy.status !== 0) {
  if (pythonPolicy.stdout) console.error(pythonPolicy.stdout.trim());
  if (pythonPolicy.stderr) console.error(pythonPolicy.stderr.trim());
  throw new Error(`python policy check failed with exit ${pythonPolicy.status}`);
}

const pythonInfo = JSON.parse(pythonPolicy.stdout || '{}');
const python = pythonInfo.python || process.env.PYTHON || 'python';

const result = spawnSync(python, [helper], {
  cwd: root,
  encoding: 'utf8',
});

if (result.stdout) console.error(result.stdout);
if (result.stderr) console.error(result.stderr);
assert.equal(result.status, 0, 'sublime paths behavior helper failed');
console.log('sublime paths behavior test passed');
