#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyActionCoverage, createCoverageState, finalizeCoverage, reportCoverage } from './script-coverage/report.js';

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

console.log('script coverage harness test passed');
