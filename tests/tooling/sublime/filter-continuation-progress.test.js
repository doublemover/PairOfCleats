import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runNode } from '../../helpers/run-node.js';

// Authored runner entry only; all Python/child/editor execution is deferred.
const root = process.cwd();
const policy = runNode(['tools/tooling/python-check.js', '--json'], 'Sublime Python policy', root, process.env, { stdio: 'pipe' });
const { python } = JSON.parse(policy.stdout);
const result = spawnSync(python, ['tests/helpers/sublime/filter_continuation_progress.py'],
  { cwd: root, encoding: 'utf8', timeout: 8000 });
assert.equal(result.status, 0, result.stderr || result.error?.message);
assert.match(result.stdout, /Sublime serialized-project continuation progress preserves original window\/context\/membership and rejects cycles/);
console.log('Sublime original operation-owned continuation progress controls authored; execution deferred.');
