import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
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
const planLines = String(result.stderr).split(/\r?\n/);
const listInvocation = line => {
  const args = line.slice(line.indexOf('tests/run.js')).trim().split(/\s+/);
  const selectors = [];
  for (let index = 1; index < args.length; index++) {
    if (['--lane', '--match', '--exclude', '--tag', '--exclude-tag'].includes(args[index])) selectors.push(args[index], args[++index]);
  }
  return runNode(['tests/run.js', ...selectors, '--list'], 'resolve actual nightly selection',
    root, env, { stdio: 'pipe' }).stdout.trim().split(/\r?\n/);
};
const mainIds = new Set(listInvocation(planLines.find(line => line.startsWith('[dry-run] CI test lane:'))));
const soak = planLines.find(line => line.startsWith('[dry-run] Operational soak and recovery suites:'));
assert.ok(soak);
for (const expected of ['--lane all', '--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000',
  '--retries 0', '--native-status-redo=false']) assert.ok(soak.includes(expected), `${expected}: ${soak}`);
const selectedSoak = runNode(['tests/run.js', '--lane', 'all', '--match', 'services/soak/operational-recovery', '--list'],
  'resolve exact supplemental soak selector', root, env, { stdio: 'pipe' });
assert.deepEqual(selectedSoak.stdout.trim().split(/\r?\n/), ['services/soak/operational-recovery']);
assert.ok(planLines.indexOf(soak) < planLines.findIndex(line => line.startsWith('[dry-run] Bench harness')));
assert.ok(planLines.findIndex(line => line.startsWith('[dry-run] Bench harness')) < planLines.indexOf(lines[0]));
assert.equal(lines.length, SCRIPT_COVERAGE_GROUPS.length);
let supplementalCases = 0;
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const ids = listInvocation(line);
  assert.ok(ids.length > 0);
  supplementalCases += ids.length;
  for (const id of ids) assert.ok(!mainIds.has(id), `main and supplemental phases repeat ${id}`);
  assert.match(line, /^\[dry-run\] Script coverage \([^)]+\): \S+ tests\/run\.js /,
    'nightly dispatch must use the real runner entrypoint, not a removed aggregate filename');
  assert.ok(line.replaceAll('\\/', '/').includes(`--match /^tooling/script-coverage/${SCRIPT_COVERAGE_GROUPS[index]}/`));
  for (const expected of ['--lane all', '--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000',
    '--retries 0', '--native-status-redo=false']) assert.ok(line.includes(expected), `${expected}: ${line}`);
}
console.log(JSON.stringify({ mainCases: mainIds.size, supplementalCases, overlap: 0 }));
const plannedOwners = new Map();
for (const line of planLines.filter(line => line.startsWith('[dry-run] ') && line.includes(' tests/run.js '))) {
  for (const id of listInvocation(line)) {
    assert.ok(!plannedOwners.has(id), `nightly repeats ${id}: ${plannedOwners.get(id)} and ${line}`);
    plannedOwners.set(id, line.slice(0, line.indexOf(':')));
  }
}
const retirement = JSON.parse(await fs.readFile(path.join(root,
  'docs/archived/script-coverage-retirement-2026-10-20.json'), 'utf8'));
for (const entry of retirement.delegations) {
  assert.ok(plannedOwners.has(entry.canonicalOwner), `retirement cannot omit ${entry.canonicalOwner}`);
  assert.ok(!plannedOwners.has(entry.wrapperId), `retired wrapper remains scheduled: ${entry.wrapperId}`);
}
console.log(JSON.stringify({ retainedCanonicalOwners: retirement.delegations.length,
  plannedCases: plannedOwners.size, repeatedCases: 0 }));
console.log('Nightly coverage dispatches every group through bounded discovered process cases');
