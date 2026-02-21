#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getCurrentBuildInfo } from '../../../tools/shared/dict-utils.js';
import { validateArtifact } from '../../../src/shared/artifact-schemas.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture-determinism-report'
});

const current = getCurrentBuildInfo(fixtureRoot, userConfig, { mode: 'code' });
const buildRoot = current?.activeRoot || current?.buildRoot || null;
assert.ok(buildRoot, 'expected fixture build root');

const reportPathCandidates = [
  path.join(buildRoot, 'index-code', 'determinism_report.json'),
  path.join(buildRoot, 'determinism_report.json')
];
const reportPath = reportPathCandidates.find((candidate) => fs.existsSync(candidate));
assert.ok(reportPath, `missing determinism_report.json at ${reportPathCandidates.join(' or ')}`);

const payload = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
const validation = validateArtifact('determinism_report', payload);
assert.ok(validation.ok, `determinism_report invalid: ${validation.errors.join('; ')}`);

assert.ok(Array.isArray(payload.stableHashExclusions), 'stableHashExclusions must be an array');
assert.ok(payload.stableHashExclusions.includes('generatedAt'), 'generatedAt exclusion missing');
assert.ok(payload.stableHashExclusions.includes('updatedAt'), 'updatedAt exclusion missing');
assert.ok(Array.isArray(payload.sourceReasons) && payload.sourceReasons.length > 0, 'sourceReasons must be populated');
assert.ok(
  payload.sourceReasons.some((entry) => entry?.path === 'generatedAt'),
  'sourceReasons should include generatedAt'
);
assert.equal(typeof payload.normalizedStateHash, 'string', 'normalizedStateHash must be a string');
assert.ok(payload.normalizedStateHash.length >= 16, 'normalizedStateHash appears empty');

console.log('determinism report artifact test passed');
