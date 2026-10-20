#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyActionCoverage, createCoverageState, finalizeCoverage, reportCoverage } from './report.js';
import { repoRoot } from '../../helpers/root.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createCommandRunner, resolveRetries } from './runner.js';
import { createInvocationRecorder, validateInvocationTargets } from './invocation-inventory.js';
import {
  collectUnknownActionCovers,
  createScriptCoverageActionsFixture
} from './coverage-fixture.js';

const unknownState = createCoverageState({ scriptNames: ['build-index'] });
applyActionCoverage(unknownState, { label: 'unknown', covers: ['missing-script'] });
const unknownSummary = finalizeCoverage(unknownState);
assert.deepEqual(unknownSummary.unknownCovers, ['missing-script']);
assert.equal(reportCoverage(unknownSummary), false, 'expected unknown covers to fail report');

const tierMissingState = createCoverageState({ scriptNames: ['build-index'] });
applyActionCoverage(tierMissingState, { label: 'tier-missing', covers: ['build-index'] });
const tierMissingSummary = finalizeCoverage(tierMissingState);
assert.equal(tierMissingSummary.missingTierB.length, 1, 'expected tier B to remain missing without override');

const tierOverrideState = createCoverageState({ scriptNames: ['build-index'] });
applyActionCoverage(tierOverrideState, { label: 'tier-override', coversTierB: ['build-index'] });
const tierOverrideSummary = finalizeCoverage(tierOverrideState);
assert.equal(tierOverrideSummary.missingTierB.length, 0, 'expected tier B override to satisfy coverage');
assert.equal(tierOverrideSummary.coveredTierB.length, 1, 'expected tier B override to mark covered');

const root = repoRoot();
// The retained explicit --fixtures invocation checks a distinct CLI selector.
// This negative proves it consumes the list rather than silently using sample.
const rejectedList = runNode([path.join(root, 'tests/tooling/fixtures/fixture-parity.test.js'),
  '--fixtures', 'deliberately-missing-parity-fixture,sample'], 'explicit fixture-list authority',
root, applyTestEnv({ syncProcess: false }), { allowFailure: true, stdio: 'pipe', timeoutMs: 10000 });
assert.equal(rejectedList.status, 1);
assert.equal(rejectedList.stderr.trim(),
  `Fixture not found: ${path.join(root, 'tests/fixtures/deliberately-missing-parity-fixture')}`);
assert.doesNotMatch(rejectedList.stdout, /Fixture parity: sample/);
assert.equal(resolveRetries({ argvRetries: 0, defaultRetries: 2 }), 0,
  'an explicit audit retry count must reach the nested runner unchanged');
const boundedRunner = createCommandRunner({ retries: 0, failureLogRoot: root });
assert.equal((await boundedRunner.run('positive-control', process.execPath, ['-e', 'process.exit(0)'])).status, 'passed');
const optional = await boundedRunner.run('optional-control', process.execPath,
  ['-e', 'console.log("wrapper preamble"); console.log("SKIP_REASON: optional capability missing"); process.exit(77)']);
assert.equal(optional.status, 'skipped',
  'a nested optional skip must not become passing action coverage');
assert.equal(optional.reason, 'optional capability missing');
const recorder = createInvocationRecorder();
const { actions, scriptNames, cleanup } = await createScriptCoverageActionsFixture({ runNode: recorder.runNode });
const unknown = collectUnknownActionCovers(actions, scriptNames);
assert.equal(unknown.size, 0, `expected no unknown covers (found: ${Array.from(unknown).join(', ')})`);
let checkedTargets;
try {
  const records = await recorder.record(actions);
  assert.equal(records.length, actions.length, 'every action is inspected, including actions with no surviving npm claim');
  checkedTargets = validateInvocationTargets(records, root);
} finally { await cleanup(); }
assert.ok(checkedTargets >= actions.length, 'the executable-reference guard validates every resolved joined action target');
const mutation = createInvocationRecorder();
const missing = await mutation.record([{ group: 'control', label: 'joined-target-without-npm-claims', covers: [],
  run: () => mutation.runNode('missing', path.join(root, 'tests', 'deliberately-missing-fixture.test.js')) }]);
assert.throws(() => validateInvocationTargets(missing, root), /stale executable target/);
missing[0].invocations[0].script = path.join(root, 'tests', 'tooling', 'config', 'contract-matrix.test.js');
assert.equal(validateInvocationTargets(missing, root), 1);
const outside = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-reference-guard-'));
try {
  missing[0].invocations[0].script = path.join(outside, 'outside.js');
  fs.writeFileSync(missing[0].invocations[0].script, '');
  assert.throws(() => validateInvocationTargets(missing, root), /escaped allowed repository root/);
} finally { await fsPromises.rm(outside, { recursive: true, force: true }); }

const executableRefRegex = /['"`]((?:[^'"`\n]*?)tests[\\/][^'"`\n]+\.test\.js)['"`]/g;
const resolveExecutableRefs = async (filePath) => {
  const source = await fsPromises.readFile(filePath, 'utf8');
  const refs = [];
  let match;
  while ((match = executableRefRegex.exec(source)) !== null) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    refs.push(path.resolve(path.dirname(filePath), raw));
  }
  return refs;
};

const smokeDir = path.join(root, 'tests', 'smoke');
for (const entry of await fsPromises.readdir(smokeDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.test.js')) continue;
  const absolutePath = path.join(smokeDir, entry.name);
  const refs = await resolveExecutableRefs(absolutePath);
  assert.deepEqual(
    refs,
    [],
    `smoke tests must not shell out to other test files: ${absolutePath}`
  );
}

console.log('script coverage harness test passed');
