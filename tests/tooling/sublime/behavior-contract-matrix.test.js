#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const checker = path.join(root, 'tools', 'tooling', 'python-check.js');

const pythonPolicy = runNode(
  [checker, '--json'],
  'sublime python policy check',
  root,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe' }
);

if (pythonPolicy.status !== 0) {
  if (pythonPolicy.stdout) console.error(pythonPolicy.stdout.trim());
  if (pythonPolicy.stderr) console.error(pythonPolicy.stderr.trim());
  throw new Error(`python policy check failed with exit ${pythonPolicy.status}`);
}

const pythonInfo = JSON.parse(pythonPolicy.stdout || '{}');
const python = pythonInfo.python || process.env.PYTHON || 'python';

const cases = [
  ['paths', 'paths_behavior.py'],
  ['index', 'index_behavior.py'],
  ['results', 'results_behavior.py'],
  ['navigation', 'navigation_behavior.py'],
  ['watch', 'watch_behavior.py'],
  ['analysis', 'analysis_behavior.py'],
  ['operator', 'operator_behavior.py'],
  ['settings', 'settings_behavior.py'],
  ['search', 'search_behavior.py'],
  ['map', 'map_behavior.py'],
  ['api-server', 'api_server.py'],
  ['runner', 'runner_behavior.py'],
  ['task', 'task_behavior.py'],
  ['visibility', 'visibility_behavior.py']
];

for (const [label, scriptName] of cases) {
  const helper = path.join(root, 'tests', 'helpers', 'sublime', scriptName);
  const result = spawnSync(python, [helper], {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  assert.equal(result.status, 0, `sublime ${label} behavior helper failed`);
}

console.log('sublime behavior contract matrix test passed');
