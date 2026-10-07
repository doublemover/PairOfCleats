#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { validateTestCoverageArtifact } from '../../src/contracts/validators/test-artifacts.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { writeTextIfChanged } from '../shared/generated-report.js';
import {
  collectSortedFiles,
  resolveRepoContainedNoSymlinkPath,
  resolveRepoContainedOutputPath,
  toPosixRelative as toPosixRelativePath
} from './file-walk.js';
import { toIso } from './metadata-support.js';

const argv = createCli({
  scriptName: 'pairofcleats release readiness-gate',
  options: {
    'prepare-report': { type: 'string', default: '' },
    'runtime-report': { type: 'string', default: '' },
    'node-verify-report': { type: 'string', default: '' },
    'tui-verify-root': { type: 'string', default: '' },
    'tui-verify-targets': { type: 'string', default: 'ubuntu,windows,macos' },
    'trust-root': { type: 'string', default: '' },
    'ci-statuses': { type: 'string', default: '' },
    'ci-test-summary': { type: 'string', default: '' },
    'release-git-sha': { type: 'string', default: '' },
    'coverage-dir': { type: 'string', default: '' },
    'attested': { type: 'boolean', default: false },
    'out-json': { type: 'string', default: 'dist/release/readiness/readiness-summary.json' },
    'out-md': { type: 'string', default: 'dist/release/readiness/readiness-summary.md' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());
const pathResolutionErrors = [];

const resolveOptionalPath = (value, optionName) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const resolution = resolveRepoContainedNoSymlinkPath(root, text, optionName);
  if (!resolution.ok) {
    pathResolutionErrors.push({
      id: `path.${optionName}`,
      detail: resolution.error
    });
    return '';
  }
  return resolution.path;
};

const prepareReportPath = resolveOptionalPath(argv['prepare-report'], 'prepare-report');
const runtimeReportPath = resolveOptionalPath(argv['runtime-report'], 'runtime-report');
const nodeVerifyReportPath = resolveOptionalPath(argv['node-verify-report'], 'node-verify-report');
const tuiVerifyRoot = resolveOptionalPath(argv['tui-verify-root'], 'tui-verify-root');
const expectedTuiTargetValues = String(argv['tui-verify-targets'] || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
const expectedTuiTargets = [];
const expectedTuiTargetErrors = [];
const expectedTuiTargetSet = new Set();
for (const [index, target] of expectedTuiTargetValues.entries()) {
  if (!target) {
    expectedTuiTargetErrors.push(`target entry ${index + 1} is empty`);
    continue;
  }
  if (!/^[a-z0-9._-]+$/.test(target)) {
    expectedTuiTargetErrors.push(`target ${target} is malformed`);
    continue;
  }
  if (expectedTuiTargetSet.has(target)) {
    expectedTuiTargetErrors.push(`target ${target} is duplicated`);
    continue;
  }
  expectedTuiTargetSet.add(target);
  expectedTuiTargets.push(target);
}
if (expectedTuiTargets.length === 0) {
  expectedTuiTargetErrors.push('at least one TUI verification target must be configured');
}
const trustRoot = resolveOptionalPath(argv['trust-root'], 'trust-root');
const ciStatusesPath = resolveOptionalPath(argv['ci-statuses'], 'ci-statuses');
const ciTestSummaryPath = resolveOptionalPath(argv['ci-test-summary'], 'ci-test-summary');
const releaseGitSha = String(argv['release-git-sha'] || process.env.RELEASE_GIT_SHA || '').trim();
const coverageDir = resolveOptionalPath(argv['coverage-dir'], 'coverage-dir');
const outJsonResolution = resolveRepoContainedOutputPath(
  root,
  String(argv['out-json'] || 'dist/release/readiness/readiness-summary.json'),
  'out-json'
);
const outMdResolution = resolveRepoContainedOutputPath(
  root,
  String(argv['out-md'] || 'dist/release/readiness/readiness-summary.md'),
  'out-md'
);
const outJsonPath = outJsonResolution.path;
const outMdPath = outMdResolution.path;

const toPosixRelative = (filePath) => toPosixRelativePath(root, filePath);
const GIT_OBJECT_ID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const RELEASE_REPORT_PHASES = new Set([
  'changelog',
  'contracts',
  'toolchain',
  'build',
  'install',
  'boot',
  'smoke'
]);
const RELEASE_REPORT_STATUSES = new Set(['passed', 'failed']);
const ISO_8601_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const blockers = [];
const addBlocker = (id, detail) => blockers.push({ id, detail });
const invalidJsonArtifactIds = new Set();
const invalidJsonArtifactPaths = new Map();

const readJsonIfExists = (filePath, blockerId = 'json', label = 'JSON artifact') => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const relPath = toPosixRelative(filePath);
    invalidJsonArtifactIds.add(blockerId);
    const invalidPaths = invalidJsonArtifactPaths.get(blockerId) || new Set();
    invalidPaths.add(relPath);
    invalidJsonArtifactPaths.set(blockerId, invalidPaths);
    addBlocker(
      `${blockerId}.invalid-json`,
      `${label} contains invalid JSON at ${relPath}: ${error?.message || error}.`
    );
    return null;
  }
};

const hasInvalidJson = (blockerId) => invalidJsonArtifactIds.has(blockerId);
const hasInvalidJsonPath = (blockerId, relPath) => invalidJsonArtifactPaths.get(blockerId)?.has(relPath) === true;

const collectTuiReports = (dirPath) => collectSortedFiles(dirPath)
  .filter((filePath) => /release_check_report\.json$/i.test(path.basename(filePath)))
  .map((filePath) => {
    const relPath = toPosixRelative(filePath);
    const payload = readJsonIfExists(filePath, 'tuiVerify', `TUI verification report ${relPath}`);
    return {
      path: relPath,
      target: resolveTuiReportTarget(filePath),
      invalidJson: hasInvalidJsonPath('tuiVerify', relPath),
      payload
    };
  });

function resolveTuiReportTarget(filePath) {
  const rel = toPosixRelative(filePath);
  const patterns = [
    /release-tui-verify-([^/]+)/i,
    /verify-tui-([^/]+)/i,
    /(?:^|\/)(ubuntu|windows|macos)(?:\/|$)/i
  ];
  for (const pattern of patterns) {
    const match = rel.match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim().toLowerCase();
    }
  }
  return null;
}

function normalizeTuiTarget(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z0-9._-]+$/.test(text) ? text : null;
}

function resolveTuiReportDeclaredTarget(payload) {
  return normalizeTuiTarget(payload?.scope?.runtimeTarget);
}

const validateReleaseReportShape = (payload) => {
  const errors = [];
  if (payload?.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }
  for (const field of ['generatedAt', 'startedAt', 'finishedAt']) {
    if (!isIso8601UtcString(payload?.[field])) {
      errors.push(`${field} must be an ISO-8601 UTC timestamp`);
    }
  }
  for (const field of ['releaseVersion']) {
    if (typeof payload?.[field] !== 'string' || payload[field].trim().length === 0) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (!payload?.strict || !Array.isArray(payload.strict.requiredChecks) || payload.strict.requiredChecks.length === 0) {
    errors.push('strict.requiredChecks must be a non-empty array');
  }
  if (payload?.strict?.skipModesDisabled !== true) {
    errors.push('strict.skipModesDisabled must be true');
  }
  const checks = Array.isArray(payload?.checks) ? payload.checks : null;
  if (!checks || checks.length === 0) {
    errors.push('checks must be a non-empty array');
  }
  const summary = payload?.summary;
  if (!summary || typeof summary !== 'object') {
    errors.push('summary must be an object');
  }
  if (!Number.isInteger(summary?.total) || summary.total < 1) {
    errors.push('summary.total must be a positive integer');
  }
  if (!Number.isInteger(summary?.passed) || summary.passed < 0) {
    errors.push('summary.passed must be a non-negative integer');
  }
  if (!Number.isInteger(summary?.failed) || summary.failed < 0) {
    errors.push('summary.failed must be a non-negative integer');
  }
  if (!summary?.byPhase || typeof summary.byPhase !== 'object' || Array.isArray(summary.byPhase)) {
    errors.push('summary.byPhase must be an object');
  }
  if (!checks) return errors;
  if (summary && Number.isInteger(summary.total) && summary.total !== checks.length) {
    errors.push(`summary.total must equal checks length (${checks.length})`);
  }
  let passed = 0;
  let failed = 0;
  const phases = new Set();
  const phaseCounts = new Map();
  for (const [index, check] of checks.entries()) {
    const prefix = `checks[${index}]`;
    if (typeof check?.id !== 'string' || check.id.trim().length === 0) {
      errors.push(`${prefix}.id must be a non-empty string`);
    }
    if (typeof check?.phase !== 'string' || !RELEASE_REPORT_PHASES.has(check.phase)) {
      errors.push(`${prefix}.phase is invalid`);
    } else {
      phases.add(check.phase);
      phaseCounts.set(check.phase, (phaseCounts.get(check.phase) || 0) + 1);
    }
    if (typeof check?.label !== 'string' || check.label.trim().length === 0) {
      errors.push(`${prefix}.label must be a non-empty string`);
    }
    if (!Array.isArray(check?.command) || check.command.length === 0) {
      errors.push(`${prefix}.command must be a non-empty array`);
    }
    if (!RELEASE_REPORT_STATUSES.has(check?.status)) {
      errors.push(`${prefix}.status is invalid`);
    } else if (check.status === 'passed') {
      passed += 1;
    } else {
      failed += 1;
    }
    if (!Number.isInteger(check?.exitCode)) {
      errors.push(`${prefix}.exitCode must be an integer`);
    }
    if (!Array.isArray(check?.artifacts)) {
      errors.push(`${prefix}.artifacts must be an array`);
    }
    for (const field of ['startedAt', 'finishedAt']) {
      if (!isIso8601UtcString(check?.[field])) {
        errors.push(`${prefix}.${field} must be an ISO-8601 UTC timestamp`);
      }
    }
  }
  if (summary?.passed !== passed) {
    errors.push(`summary.passed must equal passed checks (${passed})`);
  }
  if (summary?.failed !== failed) {
    errors.push(`summary.failed must equal failed checks (${failed})`);
  }
  if (payload.ok === true && failed > 0) {
    errors.push('ok=true report must not contain failed checks');
  }
  for (const phase of payload.strict?.requiredChecks || []) {
    if (!RELEASE_REPORT_PHASES.has(phase)) {
      errors.push(`strict.requiredChecks contains unknown phase ${phase}`);
    } else if (!phases.has(phase)) {
      errors.push(`strict.requiredChecks phase has no check: ${phase}`);
    }
  }
  const byPhase = summary?.byPhase;
  if (byPhase && typeof byPhase === 'object' && !Array.isArray(byPhase)) {
    for (const [phase, count] of Object.entries(byPhase)) {
      if (!RELEASE_REPORT_PHASES.has(phase)) {
        errors.push(`summary.byPhase contains unknown phase ${phase}`);
        continue;
      }
      const actual = phaseCounts.get(phase) || 0;
      if (count !== actual) {
        errors.push(`summary.byPhase.${phase} must equal ${actual}`);
      }
    }
    for (const [phase, actual] of phaseCounts.entries()) {
      if (!Object.hasOwn(byPhase, phase)) {
        errors.push(`summary.byPhase.${phase} must be present and equal ${actual}`);
      }
    }
  }
  return errors;
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const isIso8601UtcString = (value) => (
  typeof value === 'string'
    && ISO_8601_UTC_RE.test(value.trim())
    && !Number.isNaN(Date.parse(value.trim()))
);

const isSafeRelativePath = (value) => {
  if (!isNonEmptyString(value)) return false;
  const text = value.trim();
  if (text.includes('\\') || path.posix.isAbsolute(text) || path.win32.isAbsolute(text)) return false;
  const normalized = path.posix.normalize(text);
  return normalized !== '.'
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.split('/').includes('..');
};

const validateArtifactEntryShape = (entry, prefix) => {
  const errors = [];
  if (!isPlainObject(entry)) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }
  if (!isSafeRelativePath(entry.path)) {
    errors.push(`${prefix}.path must be a safe repo-relative POSIX path`);
  }
  if (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    errors.push(`${prefix}.sizeBytes must be a non-negative integer`);
  }
  if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
    errors.push(`${prefix}.sha256 must be a 64-character hex digest`);
  }
  return errors;
};

const validateTrustManifestShape = (payload) => {
  const errors = [];
  if (!isPlainObject(payload)) return ['trust manifest must be an object'];
  if (payload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(payload.generatedAt)) errors.push('generatedAt must be a non-empty string');
  if (!isNonEmptyString(payload.releaseVersion)) errors.push('releaseVersion must be a non-empty string');
  if (!isNonEmptyString(payload.releaseTag)) errors.push('releaseTag must be a non-empty string');
  if (payload.checksumBundlePath !== 'release-checksum-bundle.json') {
    errors.push('checksumBundlePath must be release-checksum-bundle.json');
  }
  if (payload.provenanceSummaryPath !== 'provenance-summary.json') {
    errors.push('provenanceSummaryPath must be provenance-summary.json');
  }
  const sboms = Array.isArray(payload.sboms) ? payload.sboms : null;
  if (!sboms || sboms.length === 0) {
    errors.push('sboms must be a non-empty array');
    return errors;
  }
  const sbomIds = new Set();
  for (const [index, sbom] of sboms.entries()) {
    const prefix = `sboms[${index}]`;
    if (!isPlainObject(sbom)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(sbom.id)) {
      errors.push(`${prefix}.id must be a non-empty string`);
    } else if (sbomIds.has(sbom.id)) {
      errors.push(`${prefix}.id is duplicated`);
    } else {
      sbomIds.add(sbom.id);
    }
    if (!isSafeRelativePath(sbom.path)) {
      errors.push(`${prefix}.path must be a safe relative POSIX path`);
    }
    if (sbom.format !== 'cyclonedx-json') {
      errors.push(`${prefix}.format must be cyclonedx-json`);
    }
  }
  for (const requiredId of ['node-root', 'tui']) {
    if (!sbomIds.has(requiredId)) errors.push(`sboms must include ${requiredId}`);
  }
  return errors;
};

const validateTrustSbomFiles = ({ trustManifest, trustManifestShapeErrors }) => {
  const result = {
    status: 'missing',
    files: [],
    missingFiles: [],
    invalidFiles: []
  };
  if (hasInvalidJson('trust.trustManifest')) {
    result.status = 'invalid-json';
    return result;
  }
  if (!trustManifest) return result;
  if (trustManifestShapeErrors.length > 0) {
    result.status = 'invalid-shape';
    return result;
  }
  const sboms = Array.isArray(trustManifest.sboms) ? trustManifest.sboms : [];
  for (const [index, sbom] of sboms.entries()) {
    const id = isNonEmptyString(sbom?.id) ? sbom.id : `sbom[${index}]`;
    const sbomPath = String(sbom?.path || '').trim();
    const label = `trust SBOM ${id}`;
    const resolution = resolveRepoContainedNoSymlinkPath(trustRoot, sbomPath, label);
    if (!resolution.ok || !resolution.path) {
      result.invalidFiles.push({
        id,
        path: sbomPath || id,
        error: resolution.error || `${label} path is invalid.`
      });
      continue;
    }
    let stat = null;
    try {
      stat = fs.statSync(resolution.path);
    } catch {
      result.missingFiles.push({ id, path: resolution.relative });
      continue;
    }
    if (!stat.isFile()) {
      result.invalidFiles.push({
        id,
        path: resolution.relative,
        error: `${label} must be a file: ${resolution.relative}.`
      });
      continue;
    }
    result.files.push(resolution.relative);
  }
  result.status = result.missingFiles.length === 0 && result.invalidFiles.length === 0
    ? 'present'
    : 'missing';
  return result;
};

const validateProvenanceSummaryShape = (payload) => {
  const errors = [];
  if (!isPlainObject(payload)) return ['provenance summary must be an object'];
  if (payload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(payload.generatedAt)) errors.push('generatedAt must be a non-empty string');
  if (payload.attestationProvider !== 'github-actions-attest-build-provenance') {
    errors.push('attestationProvider must be github-actions-attest-build-provenance');
  }
  if (!isNonEmptyString(payload.sha)) errors.push('sha must be a non-empty string');
  if (!Array.isArray(payload.subjects) || payload.subjects.length === 0) {
    errors.push('subjects must be a non-empty array');
  } else {
    for (const [index, subject] of payload.subjects.entries()) {
      if (!isSafeRelativePath(subject)) {
        errors.push(`subjects[${index}] must be a safe relative POSIX path`);
      }
    }
  }
  return errors;
};

const validateChecksumBundleShape = (payload) => {
  const errors = [];
  if (!isPlainObject(payload)) return ['checksum bundle must be an object'];
  if (payload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(payload.generatedAt)) errors.push('generatedAt must be a non-empty string');
  if (!isNonEmptyString(payload.releaseVersion)) errors.push('releaseVersion must be a non-empty string');
  if (!isNonEmptyString(payload.releaseTag)) errors.push('releaseTag must be a non-empty string');
  if (!isNonEmptyString(payload.sourceCommit)) errors.push('sourceCommit must be a non-empty string');
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : null;
  if (!artifacts || artifacts.length === 0) {
    errors.push('artifacts must be a non-empty array');
    return errors;
  }
  const artifactPaths = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    errors.push(...validateArtifactEntryShape(artifact, `artifacts[${index}]`));
    if (isPlainObject(artifact) && isNonEmptyString(artifact.path)) {
      if (artifactPaths.has(artifact.path)) {
        errors.push(`artifacts[${index}].path is duplicated`);
      } else {
        artifactPaths.add(artifact.path);
      }
    }
  }
  return errors;
};

const validateCiStatusesShape = (payload) => {
  const errors = [];
  if (!isPlainObject(payload)) return ['CI workflow status report must be an object'];
  if (payload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!isNonEmptyString(payload.generatedAt)) errors.push('generatedAt must be a non-empty string');
  if (!isNonEmptyString(payload.targetSha)) errors.push('targetSha must be a non-empty string');
  const workflows = Array.isArray(payload.workflows) ? payload.workflows : null;
  if (!workflows || workflows.length === 0) {
    errors.push('workflows must be a non-empty array');
    return errors;
  }
  const workflowNames = new Set();
  for (const [index, workflow] of workflows.entries()) {
    const prefix = `workflows[${index}]`;
    if (!isPlainObject(workflow)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isNonEmptyString(workflow.workflow)) {
      errors.push(`${prefix}.workflow must be a non-empty string`);
    } else if (workflowNames.has(workflow.workflow)) {
      errors.push(`${prefix}.workflow is duplicated`);
    } else {
      workflowNames.add(workflow.workflow);
    }
    if (!Number.isInteger(workflow.runId) || workflow.runId < 1) {
      errors.push(`${prefix}.runId must be a positive integer`);
    }
    if (!['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral'].includes(workflow.conclusion)) {
      errors.push(`${prefix}.conclusion is invalid`);
    }
  }
  return errors;
};

const validateCiTestSummaryShape = (payload) => {
  const errors = [];
  if (!isPlainObject(payload)) return ['CI test summary artifact must be an object'];
  const summary = isPlainObject(payload.summary) ? payload.summary : null;
  if (!summary) {
    errors.push('summary must be an object');
    return errors;
  }
  for (const field of ['total', 'passed', 'failed', 'skipped']) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) {
      errors.push(`summary.${field} must be a non-negative integer`);
    }
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    errors.push('summary.durationMs must be a non-negative number');
  }
  if (Number.isFinite(summary.total)
    && Number.isFinite(summary.passed)
    && Number.isFinite(summary.failed)
    && Number.isFinite(summary.skipped)
    && summary.total !== summary.passed + summary.failed + summary.skipped) {
    errors.push('summary.total must equal passed + failed + skipped');
  }
  if (!Array.isArray(payload.tests)) {
    errors.push('tests must be an array');
  } else if (Number.isFinite(summary.total) && payload.tests.length !== summary.total) {
    errors.push('tests length must equal summary.total');
  } else if (Array.isArray(payload.tests)) {
    const validStatuses = new Set(['passed', 'failed', 'skipped', 'redo']);
    const rowCounts = {
      passed: 0,
      failed: 0,
      skipped: 0
    };
    for (const [index, test] of payload.tests.entries()) {
      const prefix = `tests[${index}]`;
      if (!isPlainObject(test)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      for (const field of ['id', 'path', 'lane', 'status']) {
        if (!isNonEmptyString(test[field])) {
          errors.push(`${prefix}.${field} must be a non-empty string`);
        }
      }
      if (isNonEmptyString(test.path) && !isSafeRelativePath(test.path)) {
        errors.push(`${prefix}.path must be a safe repo-relative POSIX path`);
      }
      if (isNonEmptyString(test.status) && !validStatuses.has(test.status)) {
        errors.push(`${prefix}.status is invalid`);
      } else if (test.status === 'passed') {
        rowCounts.passed += 1;
      } else if (test.status === 'skipped') {
        rowCounts.skipped += 1;
      } else if (test.status === 'failed' || test.status === 'redo') {
        rowCounts.failed += 1;
      }
      if (!Number.isFinite(test.durationMs) || test.durationMs < 0) {
        errors.push(`${prefix}.durationMs must be a non-negative number`);
      }
    }
    for (const field of ['passed', 'failed', 'skipped']) {
      if (Number.isInteger(summary[field]) && summary[field] >= 0 && summary[field] !== rowCounts[field]) {
        errors.push(`summary.${field} must equal ${field} test rows (${rowCounts[field]})`);
      }
    }
  }
  return errors;
};

const validateCoverageArtifacts = (coverageFiles) => {
  const result = {
    ready: false,
    status: 'missing',
    validArtifacts: [],
    invalidArtifacts: []
  };
  const candidateFiles = coverageFiles.filter((filePath) => {
    const name = path.basename(filePath);
    return /^test-coverage-[^/\\]+\.json$/i.test(name) || /^coverage-[^/\\]+\.json$/i.test(name);
  });
  if (candidateFiles.length === 0) {
    result.status = coverageFiles.length > 0 ? 'invalid-shape' : 'missing';
    if (coverageFiles.length > 0) {
      addBlocker(
        'coverage.invalid-shape',
        'coverage artifact directory must contain a test coverage artifact named test-coverage-*.json or coverage-*.json.'
      );
    }
    return result;
  }
  for (const filePath of candidateFiles) {
    const relPath = toPosixRelative(filePath);
    const payload = readJsonIfExists(filePath, 'coverage', `coverage artifact ${relPath}`);
    if (!payload) {
      result.invalidArtifacts.push(relPath);
      continue;
    }
    const validation = validateTestCoverageArtifact(payload);
    if (!validation.ok) {
      result.invalidArtifacts.push(relPath);
      addBlocker(
        'coverage.invalid-shape',
        `coverage artifact has invalid test coverage shape at ${relPath}: ${validation.errors.slice(0, 4).join('; ')}.`
      );
      continue;
    }
    const semanticErrors = [];
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    let coveredRanges = 0;
    let totalRanges = 0;
    for (const [index, entry] of entries.entries()) {
      if (!isSafeRelativePath(entry.path)) {
        semanticErrors.push(`entries[${index}].path must be a safe repo-relative POSIX path`);
      }
      if (!Number.isFinite(entry.coveredRanges) || entry.coveredRanges < 0) {
        semanticErrors.push(`entries[${index}].coveredRanges must be a non-negative number`);
      }
      if (!Number.isFinite(entry.totalRanges) || entry.totalRanges < 0) {
        semanticErrors.push(`entries[${index}].totalRanges must be a non-negative number`);
      }
      if (Number.isFinite(entry.coveredRanges)
        && Number.isFinite(entry.totalRanges)
        && entry.coveredRanges > entry.totalRanges) {
        semanticErrors.push(`entries[${index}].coveredRanges must not exceed totalRanges`);
      }
      coveredRanges += Number(entry.coveredRanges || 0);
      totalRanges += Number(entry.totalRanges || 0);
    }
    if (!Number.isInteger(payload.summary?.files) || payload.summary.files < 0) {
      semanticErrors.push('summary.files must be a non-negative integer');
    } else if (payload.summary.files !== entries.length) {
      semanticErrors.push(`summary.files must equal entries length (${entries.length})`);
    }
    const roundedCoveredRanges = Number(coveredRanges.toFixed(3));
    const roundedTotalRanges = Number(totalRanges.toFixed(3));
    if (Number(payload.summary?.coveredRanges) !== roundedCoveredRanges) {
      semanticErrors.push(`summary.coveredRanges must equal entry total (${roundedCoveredRanges})`);
    }
    if (Number(payload.summary?.totalRanges) !== roundedTotalRanges) {
      semanticErrors.push(`summary.totalRanges must equal entry total (${roundedTotalRanges})`);
    }
    if (semanticErrors.length > 0) {
      result.invalidArtifacts.push(relPath);
      addBlocker(
        'coverage.invalid-shape',
        `coverage artifact has invalid test coverage semantics at ${relPath}: ${semanticErrors.slice(0, 4).join('; ')}.`
      );
      continue;
    }
    result.validArtifacts.push(relPath);
  }
  result.ready = result.validArtifacts.length > 0 && result.invalidArtifacts.length === 0;
  if (result.ready) {
    result.status = 'present';
  } else if (result.invalidArtifacts.length > 0) {
    result.status = hasInvalidJson('coverage') ? 'invalid-json' : 'invalid-shape';
  }
  return result;
};

const assertReleaseReport = (label, filePath, payload) => {
  if (!filePath || !payload) {
    if (!filePath || !fs.existsSync(filePath)) {
      addBlocker(`${label}.missing`, `${label} report is missing.`);
    }
    return { ok: false, path: filePath ? toPosixRelative(filePath) : null };
  }
  const shapeErrors = validateReleaseReportShape(payload);
  if (shapeErrors.length > 0) {
    addBlocker(
      `${label}.invalid-shape`,
      `${label} report has invalid release-check shape: ${shapeErrors.slice(0, 4).join('; ')}.`
    );
    return { ok: false, path: toPosixRelative(filePath), invalidShape: true };
  }
  if (payload.ok !== true) {
    addBlocker(`${label}.failed`, `${label} report is not ok.`);
  }
  return {
    ok: payload.ok === true,
    path: toPosixRelative(filePath),
    summary: payload.summary || null
  };
};

const run = async () => {
  if (!outJsonResolution.ok) {
    throw new Error(`release readiness gate: ${outJsonResolution.error}`);
  }
  if (!outMdResolution.ok) {
    throw new Error(`release readiness gate: ${outMdResolution.error}`);
  }
  for (const error of pathResolutionErrors) {
    addBlocker(error.id, error.detail);
  }
  const prepareReport = readJsonIfExists(prepareReportPath, 'prepare', 'prepare release check report');
  const runtimeReport = readJsonIfExists(runtimeReportPath, 'runtime', 'runtime release check report');
  const nodeVerifyReport = readJsonIfExists(nodeVerifyReportPath, 'nodeVerify', 'node package verification report');
  const tuiReports = collectTuiReports(tuiVerifyRoot);
  const trustManifest = readJsonIfExists(
    trustRoot ? path.join(trustRoot, 'trust-manifest.json') : '',
    'trust.trustManifest',
    'trust manifest'
  );
  const provenanceSummary = readJsonIfExists(
    trustRoot ? path.join(trustRoot, 'provenance-summary.json') : '',
    'trust.provenanceSummary',
    'provenance summary'
  );
  const checksumBundle = readJsonIfExists(
    trustRoot ? path.join(trustRoot, 'release-checksum-bundle.json') : '',
    'trust.checksumBundle',
    'release checksum bundle'
  );
  const ciStatuses = readJsonIfExists(ciStatusesPath, 'ci.statuses', 'CI workflow status report');
  const ciTestSummary = readJsonIfExists(ciTestSummaryPath, 'ci.test-summary', 'CI test summary artifact');
  const coverageFiles = collectSortedFiles(coverageDir);
  const coverageValidation = validateCoverageArtifacts(coverageFiles);
  const trustShapeErrors = {
    trustManifest: !hasInvalidJson('trust.trustManifest') && trustManifest
      ? validateTrustManifestShape(trustManifest)
      : [],
    provenanceSummary: !hasInvalidJson('trust.provenanceSummary') && provenanceSummary
      ? validateProvenanceSummaryShape(provenanceSummary)
      : [],
    checksumBundle: !hasInvalidJson('trust.checksumBundle') && checksumBundle
      ? validateChecksumBundleShape(checksumBundle)
      : []
  };
  const trustSbomFiles = validateTrustSbomFiles({
    trustManifest,
    trustManifestShapeErrors: trustShapeErrors.trustManifest
  });
  const ciStatusesShapeErrors = !hasInvalidJson('ci.statuses') && ciStatuses
    ? validateCiStatusesShape(ciStatuses)
    : [];
  const ciTestSummaryShapeErrors = !hasInvalidJson('ci.test-summary') && ciTestSummary
    ? validateCiTestSummaryShape(ciTestSummary)
    : [];
  const addInvalidShapeBlocker = (id, label, errors) => {
    if (errors.length === 0) return;
    addBlocker(
      `${id}.invalid-shape`,
      `${label} has invalid shape: ${errors.slice(0, 4).join('; ')}.`
    );
  };
  addInvalidShapeBlocker('trust.trustManifest', 'trust manifest', trustShapeErrors.trustManifest);
  addInvalidShapeBlocker('trust.provenanceSummary', 'provenance summary', trustShapeErrors.provenanceSummary);
  addInvalidShapeBlocker('trust.checksumBundle', 'release checksum bundle', trustShapeErrors.checksumBundle);
  addInvalidShapeBlocker('ci.statuses', 'CI workflow status report', ciStatusesShapeErrors);
  addInvalidShapeBlocker('ci.test-summary', 'CI test summary artifact', ciTestSummaryShapeErrors);
  if (trustSbomFiles.missingFiles.length > 0) {
    addBlocker(
      'trust.sboms',
      `trust manifest SBOM files are missing: ${trustSbomFiles.missingFiles
        .map((entry) => `${entry.id}:${entry.path}`)
        .join(', ')}.`
    );
  }
  if (trustSbomFiles.invalidFiles.length > 0) {
    addBlocker(
      'trust.sboms',
      `trust manifest SBOM files are invalid: ${trustSbomFiles.invalidFiles
        .map((entry) => `${entry.id}:${entry.error}`)
        .join(', ')}.`
    );
  }

  const releaseChecks = {
    prepare: assertReleaseReport('prepare', prepareReportPath, prepareReport),
    runtime: assertReleaseReport('runtime', runtimeReportPath, runtimeReport),
    nodeVerify: assertReleaseReport('nodeVerify', nodeVerifyReportPath, nodeVerifyReport),
    tuiVerify: (() => {
      const reports = tuiReports.map((entry) => ({
        path: entry.path,
        target: entry.target,
        declaredTarget: !entry.invalidJson && entry.payload
          ? resolveTuiReportDeclaredTarget(entry.payload)
          : null,
        invalidJson: entry.invalidJson,
        invalidShape: !entry.invalidJson && entry.payload
          ? validateReleaseReportShape(entry.payload).length > 0
          : false,
        ok: entry.payload?.ok === true,
        targetMismatch: false
      })).map((entry) => ({
        ...entry,
        targetMismatch: Boolean(entry.target)
          && !entry.invalidJson
          && !entry.invalidShape
          && entry.declaredTarget !== entry.target
      }));
      const reportsByTarget = new Map();
      for (const report of reports) {
        if (!report.target) continue;
        const targetReports = reportsByTarget.get(report.target) || [];
        targetReports.push(report);
        reportsByTarget.set(report.target, targetReports);
      }
      const missingTargets = expectedTuiTargets.filter((target) => !reportsByTarget.has(target));
      const expectedTargetSet = new Set(expectedTuiTargets);
      const invalidReports = reports
        .filter((entry) => expectedTargetSet.has(entry.target) && entry.invalidJson)
        .map((entry) => entry.path);
      const invalidShapeReports = reports
        .filter((entry) => expectedTargetSet.has(entry.target) && entry.invalidShape)
        .map((entry) => entry.path);
      const failedReports = reports
        .filter((entry) => expectedTargetSet.has(entry.target) && !entry.invalidJson && !entry.invalidShape && !entry.ok)
        .map((entry) => entry.path);
      const targetMismatchReports = reports
        .filter((entry) => expectedTargetSet.has(entry.target) && entry.targetMismatch)
        .map((entry) => ({
          path: entry.path,
          expectedTarget: entry.target,
          declaredTarget: entry.declaredTarget
        }));
      const duplicateTargets = expectedTuiTargets
        .filter((target) => (reportsByTarget.get(target) || []).length > 1)
        .map((target) => ({
          target,
          paths: (reportsByTarget.get(target) || []).map((report) => report.path)
        }));
      const allPresent = missingTargets.length === 0;
      const allPassing = expectedTuiTargets.every((target) => {
        const targetReports = reportsByTarget.get(target) || [];
        return targetReports.length === 1
          && targetReports[0].ok
          && !targetReports[0].invalidJson
          && !targetReports[0].invalidShape
          && !targetReports[0].targetMismatch;
      });
      return {
        ok: expectedTuiTargets.length > 0
          && expectedTuiTargetErrors.length === 0
          && allPresent
          && allPassing,
        expectedTargets: expectedTuiTargets,
        targetErrors: expectedTuiTargetErrors,
        missingTargets,
        invalidReports,
        invalidShapeReports,
        failedReports,
        targetMismatchReports,
        duplicateTargets,
        reports
      };
    })()
  };
  if (!releaseChecks.tuiVerify.ok) {
    if (releaseChecks.tuiVerify.targetErrors.length > 0) {
      addBlocker(
        'tuiVerify.targets',
        `invalid TUI verification target configuration: ${releaseChecks.tuiVerify.targetErrors.join('; ')}.`
      );
    }
    if (releaseChecks.tuiVerify.missingTargets.length > 0) {
      addBlocker(
        'tuiVerify.missing',
        `missing required TUI verification targets: ${releaseChecks.tuiVerify.missingTargets.join(', ')}.`
      );
    }
    if (releaseChecks.tuiVerify.duplicateTargets.length > 0) {
      const duplicateDetail = releaseChecks.tuiVerify.duplicateTargets
        .map((entry) => `${entry.target}: ${entry.paths.join(', ')}`)
        .join('; ');
      addBlocker('tuiVerify.duplicates', `duplicate TUI verification reports found for targets: ${duplicateDetail}.`);
    }
    if (releaseChecks.tuiVerify.failedReports.length > 0) {
      addBlocker(
        'tuiVerify.failed',
        `failing TUI verification reports: ${releaseChecks.tuiVerify.failedReports.join(', ')}.`
      );
    }
    if (releaseChecks.tuiVerify.invalidShapeReports.length > 0) {
      addBlocker(
        'tuiVerify.invalid-shape',
        `TUI verification reports with invalid release-check shape: ${releaseChecks.tuiVerify.invalidShapeReports.join(', ')}.`
      );
    }
    if (releaseChecks.tuiVerify.targetMismatchReports.length > 0) {
      const mismatchDetail = releaseChecks.tuiVerify.targetMismatchReports
        .map((entry) => `${entry.path} expected ${entry.expectedTarget} declared ${entry.declaredTarget || 'missing'}`)
        .join('; ');
      addBlocker(
        'tuiVerify.target-mismatch',
        `TUI verification reports with mismatched runtime target: ${mismatchDetail}.`
      );
    }
    const hasOnlyClassifiedReportFailures = (
      releaseChecks.tuiVerify.targetErrors.length > 0
        || releaseChecks.tuiVerify.invalidReports.length > 0
        || releaseChecks.tuiVerify.invalidShapeReports.length > 0
        || releaseChecks.tuiVerify.targetMismatchReports.length > 0
    )
      && releaseChecks.tuiVerify.missingTargets.length === 0
      && releaseChecks.tuiVerify.duplicateTargets.length === 0
      && releaseChecks.tuiVerify.failedReports.length === 0
      && releaseChecks.tuiVerify.reports.every((entry) => (
        entry.ok
          || entry.invalidJson
          || entry.invalidShape
          || entry.targetMismatch
          || !expectedTuiTargets.includes(entry.target)
      ));
    if (
      !hasOnlyClassifiedReportFailures
      && releaseChecks.tuiVerify.missingTargets.length === 0
      && releaseChecks.tuiVerify.duplicateTargets.length === 0
      && releaseChecks.tuiVerify.failedReports.length === 0
      && releaseChecks.tuiVerify.invalidShapeReports.length === 0
      && releaseChecks.tuiVerify.targetMismatchReports.length === 0
      && releaseChecks.tuiVerify.targetErrors.length === 0
    ) {
      addBlocker('tuiVerify.failed', 'one or more required TUI verification reports are missing or failed.');
    }
  }
  const jsonArtifactStatus = (blockerId, present) => {
    if (hasInvalidJson(blockerId)) return 'invalid-json';
    return present ? 'present' : 'missing';
  };
  const trustChecks = {
    trustManifest: trustShapeErrors.trustManifest.length > 0
      ? 'invalid-shape'
      : jsonArtifactStatus('trust.trustManifest', Boolean(trustManifest)),
    provenanceSummary: trustShapeErrors.provenanceSummary.length > 0
      ? 'invalid-shape'
      : jsonArtifactStatus('trust.provenanceSummary', Boolean(provenanceSummary)),
    checksumBundle: trustShapeErrors.checksumBundle.length > 0
      ? 'invalid-shape'
      : jsonArtifactStatus('trust.checksumBundle', Boolean(checksumBundle)),
    sboms: trustSbomFiles.status,
    attested: argv.attested === true ? 'ready' : 'missing'
  };
  for (const [key, status] of Object.entries(trustChecks)) {
    if (key === 'sboms') continue;
    if (status !== 'present' && status !== 'ready') {
      if (hasInvalidJson(`trust.${key}`)) continue;
      if (status === 'invalid-shape') continue;
      addBlocker(`trust.${key}`, `required trust material ${key} is missing or false.`);
    }
  }

  const requiredCiWorkflows = ['CI', 'CI Long'];
  const ciStatusTargetSha = typeof ciStatuses?.targetSha === 'string' ? ciStatuses.targetSha.trim() : '';
  const normalizedReleaseGitSha = GIT_OBJECT_ID_RE.test(releaseGitSha) ? releaseGitSha.toLowerCase() : '';
  const normalizedCiStatusTargetSha = GIT_OBJECT_ID_RE.test(ciStatusTargetSha) ? ciStatusTargetSha.toLowerCase() : '';
  const validateTrustSha = ({ label, value }) => {
    const text = String(value || '').trim();
    if (!normalizedReleaseGitSha) return;
    if (!text) {
      addBlocker('trust.source-commit', `${label} is missing the release source commit.`);
    } else if (!GIT_OBJECT_ID_RE.test(text)) {
      addBlocker('trust.source-commit', `${label} source commit is malformed: ${text}.`);
    } else if (text.toLowerCase() !== normalizedReleaseGitSha) {
      addBlocker(
        'trust.source-commit',
        `${label} source commit ${text} does not match release git SHA ${releaseGitSha}.`
      );
    }
  };
  if (!hasInvalidJson('trust.provenanceSummary') && provenanceSummary) {
    validateTrustSha({ label: 'provenance summary', value: provenanceSummary.sha });
  }
  if (!hasInvalidJson('trust.checksumBundle') && checksumBundle) {
    validateTrustSha({ label: 'checksum bundle', value: checksumBundle.sourceCommit });
  }
  const ciStatusesShapeValid = ciStatusesShapeErrors.length === 0;
  if (!hasInvalidJson('ci.statuses')) {
    if (!releaseGitSha) {
      addBlocker('ci.target-sha', 'release git SHA is required to verify CI workflow status provenance.');
    } else if (!GIT_OBJECT_ID_RE.test(releaseGitSha)) {
      addBlocker('ci.target-sha', `release git SHA is malformed: ${releaseGitSha}.`);
    } else if (!ciStatusTargetSha) {
      addBlocker('ci.target-sha', 'CI workflow status report is missing targetSha.');
    } else if (!GIT_OBJECT_ID_RE.test(ciStatusTargetSha)) {
      addBlocker('ci.target-sha', `CI workflow status targetSha is malformed: ${ciStatusTargetSha}.`);
    } else if (normalizedCiStatusTargetSha !== normalizedReleaseGitSha) {
      addBlocker(
        'ci.target-sha',
        `CI workflow status targetSha ${ciStatusTargetSha} does not match release git SHA ${releaseGitSha}.`
      );
    }
  }
  const ciWorkflowStatuses = requiredCiWorkflows.map((workflowName) => {
    const runEntry = Array.isArray(ciStatuses?.workflows)
      ? ciStatuses.workflows.find((entry) => entry.workflow === workflowName)
      : null;
    const success = runEntry?.conclusion === 'success';
    if (!success && !hasInvalidJson('ci.statuses') && ciStatusesShapeValid) {
      addBlocker(`ci.${workflowName.replace(/\s+/g, '-').toLowerCase()}`, `${workflowName} is not successful for this commit.`);
    }
    return {
      workflow: workflowName,
      success,
      runId: runEntry?.runId || null,
      conclusion: runEntry?.conclusion || null
    };
  });

  if (!coverageValidation.ready
    && !hasInvalidJson('coverage')
    && coverageValidation.status !== 'invalid-shape') {
    addBlocker('coverage.missing', 'coverage artifact directory is missing or empty.');
  }
  const testSummaryReady = Boolean(ciTestSummary?.summary) && ciTestSummaryShapeErrors.length === 0;
  const testSummaryHasFailures = testSummaryReady && Number(ciTestSummary.summary.failed) > 0;
  const testSummaryStatus = ciTestSummaryShapeErrors.length > 0
    ? 'invalid-shape'
    : (testSummaryHasFailures ? 'failed' : jsonArtifactStatus('ci.test-summary', testSummaryReady));
  if (!testSummaryReady && !hasInvalidJson('ci.test-summary') && ciTestSummaryShapeErrors.length === 0) {
    addBlocker('ci.test-summary', 'CI test summary artifact is missing or invalid.');
  }
  if (testSummaryHasFailures) {
    addBlocker(
      'ci.test-summary.failed',
      `CI test summary reports ${ciTestSummary.summary.failed} failed or redo test row(s).`
    );
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: toIso(),
    ok: blockers.length === 0,
    blockers,
    releaseChecks,
    trustChecks,
    ci: {
      workflows: ciWorkflowStatuses,
      releaseGitSha: normalizedReleaseGitSha || releaseGitSha || null,
      targetSha: normalizedCiStatusTargetSha || ciStatusTargetSha || null,
      testSummaryStatus,
      testSummaryPath: ciTestSummaryPath ? toPosixRelative(ciTestSummaryPath) : null,
      coverageDir: coverageDir ? toPosixRelative(coverageDir) : null,
      coverageStatus: coverageValidation.status,
      coverageFiles: coverageFiles.map((filePath) => toPosixRelative(filePath)),
      coverageArtifacts: coverageValidation.validArtifacts,
      invalidCoverageArtifacts: coverageValidation.invalidArtifacts
    }
  };

  const markdown = [
    '# Release Readiness',
    '',
    `- generated: ${payload.generatedAt}`,
    `- ship: ${payload.ok ? 'yes' : 'no'}`,
    '',
    '## Release checks',
    '',
    `- prepare: ${releaseChecks.prepare.ok ? 'pass' : 'fail'}${releaseChecks.prepare.path ? ` (${releaseChecks.prepare.path})` : ''}`,
    `- runtime verification: ${releaseChecks.runtime.ok ? 'pass' : 'fail'}${releaseChecks.runtime.path ? ` (${releaseChecks.runtime.path})` : ''}`,
    `- node package verification: ${releaseChecks.nodeVerify.ok ? 'pass' : 'fail'}${releaseChecks.nodeVerify.path ? ` (${releaseChecks.nodeVerify.path})` : ''}`,
    `- tui verification: ${releaseChecks.tuiVerify.ok ? 'pass' : 'fail'}`,
    '',
    '## Trust material',
    '',
    `- trust manifest: ${trustChecks.trustManifest}`,
    `- provenance summary: ${trustChecks.provenanceSummary}`,
    `- checksum bundle: ${trustChecks.checksumBundle}`,
    `- attestation: ${trustChecks.attested}`,
    '',
    '## CI',
    '',
    ...ciWorkflowStatuses.map((entry) => `- ${entry.workflow}: ${entry.success ? 'success' : 'missing/failing'}${entry.runId ? ` (run ${entry.runId})` : ''}`),
    `- test summary: ${testSummaryStatus}`,
    `- coverage status: ${coverageValidation.status}`,
    `- coverage files: ${coverageFiles.length}`,
    '',
    '## Blockers',
    '',
    ...(blockers.length > 0
      ? blockers.map((blocker) => `- ${blocker.id}: ${blocker.detail}`)
      : ['- none'])
  ].join('\n');

  await writeJsonFileResolved(outJsonPath, payload, { trailingNewline: true });
  await writeTextIfChanged(outMdPath, `${markdown}\n`, { encoding: 'utf8' });

  process.stdout.write(`${JSON.stringify({
    ok: payload.ok,
    blockers: blockers.length,
    outJson: toPosixRelative(outJsonPath),
    outMd: toPosixRelative(outMdPath)
  })}\n`);

  if (!payload.ok) {
    process.exit(1);
  }
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
