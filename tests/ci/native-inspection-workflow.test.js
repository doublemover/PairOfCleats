import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { loadRunRules } from '../runner/run-config.js';
import { compileMatchers, discoverTests } from '../runner/run-discovery.js';

const root = process.cwd();
const workflow = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const inspection = workflow.jobs['native-inspection'];
const workflows = workflow.jobs['native-index-workflows-windows'];
assert.ok(workflows, 'Windows index workflows need an independent job lifetime');
assert.deepEqual(inspection.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
assert.equal(workflows['runs-on'], 'windows-latest', 'the new execution boundary is Windows-only');

const assertPreparation = job => {
  assert.equal(job.needs, 'gate');
  assert.equal(job['timeout-minutes'], 20);
  assert.ok(!job['continue-on-error']);
  const steps = job.steps, commands = steps.map(step => step.run || '');
  assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref, '${{ github.event.pull_request.head.sha || github.sha }}');
  assert.equal(steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version-file'], '.nvmrc');
  for (const command of ['git rev-parse HEAD', 'npm run bootstrap:ci',
    'node tools/setup/rebuild-native.js --verify', 'cargo build --locked --manifest-path crates/pairofcleats-tui/Cargo.toml']) {
    assert.ok(commands.includes(command), 'missing actual prerequisite: ' + command);
  }
  const cache = steps.find(step => step.id === 'node-modules-cache');
  assert.equal(cache.uses, 'actions/cache/restore@v6', 'native jobs only borrow the normal CI cache');
  assert.equal(cache.if, "runner.os == 'Windows'");
  assert.deepEqual(cache.with.path.trim().split('\n'), ['node_modules', '.cache/native-build/headers']);
  assert.equal(cache.with.key, "node-modules-${{ runner.os }}-${{ runner.arch }}-node-26.13.0-headers-v1-${{ hashFiles('package-lock.json', 'patches/**/*.patch') }}");
  assert.equal(cache.with['restore-keys'], undefined);
  const bootstrap = steps.find(step => step.run === 'npm run bootstrap:ci');
  assert.equal(bootstrap.env.npm_config_logs_dir, '${{ github.workspace }}/.diagnostics/native-bootstrap/npm-logs',
    'failed nested npm installers must leave job-owned diagnostic logs');
  assert.equal(bootstrap.if, "runner.os != 'Windows' || steps.node-modules-cache.outputs.cache-hit != 'true'",
    'missing/partial Windows caches and every non-Windows launch retain locked bootstrap');
  const verify = steps.find(step => step.run === 'node tools/setup/rebuild-native.js --verify');
  assert.equal(verify.if, undefined, 'exact cache hits still require actual native/patch verification');
  assert.ok(!verify['continue-on-error']);
  const firstTest = steps.findIndex(step => step.run?.includes('node tests/run.js'));
  assert.ok(steps.indexOf(cache) < steps.indexOf(bootstrap));
  assert.ok(steps.indexOf(bootstrap) < steps.indexOf(verify));
  assert.ok(steps.indexOf(verify) < firstTest);
  const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.if, 'always()');
  assert.equal(upload.with['include-hidden-files'], true);
  assert.equal(upload.with['retention-days'], 7);
  assert.ok(upload.with.path.includes('.testLogs/**'));
  assert.ok(upload.with.path.trim().split('\n').includes('.diagnostics/native-bootstrap/**'),
    'a bootstrap failure must retain diagnostics before any native fixture runs');
  for (const witness of ['native-source-identity.json', 'terminal-receipt*.json', 'screen-*.txt',
    'pids.jsonl', 'fixture-phases.jsonl', 'index-workflow-native-*.jsonl', 'fixture-settlement.json']) {
    assert.ok(upload.with.path.includes(witness), 'missing bounded native witness: ' + witness);
  }
  return steps.slice(0, firstTest);
};
assert.deepEqual(assertPreparation(inspection), assertPreparation(workflows), 'both jobs retain identical preparation');
assert.notEqual(inspection.steps.at(-1).with.name, workflows.steps.at(-1).with.name, 'artifact names must not collide');
for (const mutation of [
  job => { job.steps.find(step => step.run === 'node tools/setup/rebuild-native.js --verify').if = "steps.node-modules-cache.outputs.cache-hit != 'true'"; },
  job => { job.steps.find(step => step.id === 'node-modules-cache').with.key = 'unqualified-old-cache'; },
  job => { job.steps.find(step => step.run === 'npm run bootstrap:ci').if = "steps.node-modules-cache.outputs.cache-hit == 'true'"; },
  job => { delete job.steps.find(step => step.run === 'npm run bootstrap:ci').env.npm_config_logs_dir; },
  job => { const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
    upload.with.path = upload.with.path.replace('.diagnostics/native-bootstrap/**', ''); }
]) {
  const invalid = structuredClone(workflows); mutation(invalid);
  assert.throws(() => assertPreparation(invalid), 'cache state cannot waive preparation/admission');
}

// The actual case inventory and runner matcher prove no omitted or repeated case.
const rules = loadRunRules({ root });
const discovered = await discoverTests({ testsDir: path.join(root, 'tests'),
  excludedDirs: rules.excludedDirs, excludedFiles: rules.excludedFiles });
const originalOwners = [
  /^tui\/(native-job-inspection|native-artifact-actions|native-index-workflows)\//,
  /^tooling\/install\/node-pty-(conout-disposal|patch-roundtrip|fresh-lifecycle)(\/|$)/,
  /^(lang\/perl\/|tooling\/install\/(native-parser-error-contract|perl-patch-roundtrip|tree-sitter-patch-roundtrip|native-grammar-activation)$)/,
  /^(indexing\/build-state\/produced-contract|tui\/(operator-index-workflows|supervisor-index-workflows|supervisor-index-build))$/
];
const expected = discovered.filter(test => originalOwners.some(owner => owner.test(test.id))).map(test => test.id).sort();
assert.equal(expected.length, 71, 'native coverage changes require reviewing conserved job budgets');
const selectedBy = (job, os) => job.steps.flatMap(step => {
  if (!step.run?.includes('node tests/run.js')) return [];
  assert.ok([undefined, "runner.os == 'Windows'", "runner.os != 'Windows'"].includes(step.if));
  if (step.if === "runner.os == 'Windows'" && os !== 'Windows'
    || step.if === "runner.os != 'Windows'" && os === 'Windows') return [];
  assert.ok(!step['continue-on-error']);
  assert.doesNotMatch(step.run, /--(?:exclude|allow-timeouts)\b/);
  for (const option of ['--jobs 1', '--pairofcleats-threads 1', '--timeout-ms 30000', '--retries 0', '--native-status-redo=false']) {
    assert.ok(step.run.includes(option), 'native qualification must retain ' + option);
  }
  const patterns = [...step.run.matchAll(/--match '([^']+)'/g)].map(match => match[1]);
  assert.ok(patterns.length);
  const matchers = compileMatchers(patterns, 'native-workflow-contract');
  const selected = discovered.filter(test => matchers.some(matcher => matcher.test(test.id) || matcher.test(test.relPath)));
  assert.ok(selected.length, 'every qualification step must execute real discovered fixtures');
  return selected.map(test => test.id);
});
const windowsInspection = selectedBy(inspection, 'Windows'), windowsJob = selectedBy(workflows, 'Windows');
const vendorCases = discovered.filter(test => /^tooling\/typescript-api7-native\//.test(test.id)).map(test => test.id).sort();
assert.equal(vendorCases.length, 7, 'the added TypeScript7.1 cohort has its own exact inventory');
const vendorSet = new Set(vendorCases);
const selectedVendor = windowsJob.filter(id => vendorSet.has(id));
assert.deepEqual(selectedVendor.slice().sort(), vendorCases, 'every actual vendor request/disposal case runs exactly once');
const searchCases = discovered.filter(test => /^tui\/native-search-conpty\//.test(test.id)).map(test => test.id).sort();
assert.equal(searchCases.length, 18, 'native search has its own reviewed case inventory and step lifetime');
const searchSet = new Set(searchCases);
assert.deepEqual(windowsJob.filter(id => searchSet.has(id)).sort(), searchCases,
  'all original and narrow-terminal native search cases run exactly once');
const windowsWorkflows = windowsJob.filter(id => !vendorSet.has(id) && !searchSet.has(id));
assert.equal(new Set(windowsJob).size, windowsJob.length, 'the independent vendor cohort cannot duplicate native cases');
assert.equal(windowsInspection.length, 49);
assert.equal(windowsWorkflows.length, 22);
const windows = [...windowsInspection, ...windowsWorkflows];
assert.equal(new Set(windows).size, windows.length);
assert.deepEqual(windows.sort(), expected);
for (const os of ['Linux', 'macOS']) assert.deepEqual(selectedBy(inspection, os).sort(), expected);
console.log('Windows native CI conserves71 original cases across49/22-case jobs plus18 search and7 vendor cases; job and fixture limits remain20min/30s');
