#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { applyActionCoverage, createCoverageState, finalizeCoverage, reportCoverage } from './report.js';
import { repoRoot } from '../../helpers/root.js';
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
const { actions, scriptNames, cleanup } = await createScriptCoverageActionsFixture();
const unknown = collectUnknownActionCovers(actions, scriptNames);
await cleanup();
assert.equal(unknown.size, 0, `expected no unknown covers (found: ${Array.from(unknown).join(', ')})`);

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

const actionDir = path.join(root, 'tests', 'tooling', 'script-coverage', 'actions');
for (const entry of await fsPromises.readdir(actionDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const absolutePath = path.join(actionDir, entry.name);
  for (const ref of await resolveExecutableRefs(absolutePath)) {
    assert.equal(fs.existsSync(ref), true, `stale executable ref in ${absolutePath}: ${ref}`);
  }
}

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
