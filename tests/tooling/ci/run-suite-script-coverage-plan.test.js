import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { SCRIPT_COVERAGE_GROUPS } from '../script-coverage/actions.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('nightly-script-coverage-plan');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), syncProcess: false,
  extraEnv: { PAIROFCLEATS_HOME: path.join(dir, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
const result = runNode([path.join(root, 'tools/ci/run-suite.js'), '--mode', 'nightly', '--dry-run',
  '--skip-prechecks', '--diagnostics', path.join(dir, 'diagnostics'), '--log-dir', path.join(dir, 'logs'),
  '--junit', path.join(dir, 'logs/junit.xml')], 'nightly coverage plan', root, env, { stdio: 'pipe' });
const lines = String(result.stderr).split(/\r?\n/).filter(line => line.startsWith('[dry-run] Script coverage ('));
assert.equal(lines.length, SCRIPT_COVERAGE_GROUPS.length);
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  assert.match(line, /^\[dry-run\] Script coverage \([^)]+\): \S+ tests\/run\.js /,
    'nightly dispatch must use the real runner entrypoint, not a removed aggregate filename');
  assert.ok(line.replaceAll('\\/', '/').includes(`--match /^tooling/script-coverage/${SCRIPT_COVERAGE_GROUPS[index]}/`));
  for (const expected of ['--lane all', '--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000',
    '--retries 0', '--native-status-redo=false']) assert.ok(line.includes(expected), `${expected}: ${line}`);
}
console.log('Nightly coverage dispatches every group through bounded discovered process cases');
