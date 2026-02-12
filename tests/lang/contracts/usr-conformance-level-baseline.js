import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunRules } from '../../runner/run-config.js';
import {
  validateUsrConformanceLevelCoverage,
  buildUsrConformanceLevelSummaryReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const loadRegistry = (registryId) => {
  const filePath = path.join(matrixDir, `${registryId}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

export const runUsrConformanceLevelBaselineValidation = ({ targetLevel, lane }) => {
  const languageProfiles = loadRegistry('usr-language-profiles');
  const conformanceLevels = loadRegistry('usr-conformance-levels');
  const runRules = loadRunRules({ root: repoRoot });
  const knownLanes = Array.from(runRules.knownLanes || []);

  const coverage = validateUsrConformanceLevelCoverage({
    targetLevel,
    languageProfilesPayload: languageProfiles,
    conformanceLevelsPayload: conformanceLevels,
    knownLanes
  });
  assert.equal(coverage.ok, true, `${targetLevel} conformance coverage should pass: ${coverage.errors.join('; ')}`);

  const requiredRows = coverage.rows.filter((row) => row.requiresLevel);
  assert.equal(requiredRows.length, languageProfiles.rows.length, `${targetLevel} should be required for every language profile`);
  assert.equal(requiredRows.every((row) => row.pass), true, `${targetLevel} required rows should pass`);

  const report = buildUsrConformanceLevelSummaryReport({
    targetLevel,
    languageProfilesPayload: languageProfiles,
    conformanceLevelsPayload: conformanceLevels,
    knownLanes,
    lane,
    runId: `run-usr-${String(targetLevel).toLowerCase()}-baseline-001`,
    producerId: 'usr-conformance-level-baseline-tests'
  });
  assert.equal(report.ok, true, `${targetLevel} conformance summary report should pass: ${report.errors.join('; ')}`);

  const reportValidation = validateUsrReport('usr-conformance-summary', report.payload);
  assert.equal(reportValidation.ok, true, `${targetLevel} conformance summary payload must validate: ${reportValidation.errors.join('; ')}`);

  const expectedLane = targetLevel === 'C0' ? 'conformance-c0' : (targetLevel === 'C1' ? 'conformance-c1' : lane);
  const missingLaneCoverage = validateUsrConformanceLevelCoverage({
    targetLevel,
    languageProfilesPayload: languageProfiles,
    conformanceLevelsPayload: conformanceLevels,
    knownLanes: knownLanes.filter((laneId) => laneId !== expectedLane)
  });
  assert.equal(missingLaneCoverage.ok, false, `${targetLevel} conformance coverage should fail when ${expectedLane} lane is missing`);
};
