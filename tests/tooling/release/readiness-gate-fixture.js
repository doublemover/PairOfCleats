import fs from 'node:fs';
import path from 'node:path';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';

const writeJson = (targetPath, payload) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
};

const createReleaseReport = (root, {
  id = 'fixture.check',
  phase = 'smoke',
  label = 'fixture release check',
  status = 'passed',
  generatedAt = '2026-05-21T18:31:24Z',
  startedAt = '2026-05-21T18:31:24Z',
  finishedAt = '2026-05-21T18:31:24Z',
  checkStartedAt = startedAt,
  checkFinishedAt = finishedAt,
  runtimeTarget = null,
  summaryByPhase = null
} = {}) => ({
  schemaVersion: 1,
  generatedAt,
  startedAt,
  finishedAt,
  durationMs: 0,
  root: root.replace(/\\/g, '/'),
  releaseVersion: '0.3.0',
  scope: {
    surfaces: null,
    phases: null,
    runtimeTarget
  },
  strict: {
    skipModesDisabled: true,
    requiredChecks: [phase]
  },
  shippedSurfaces: [],
  summary: {
    total: 1,
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'passed' ? 0 : 1,
    byPhase: summaryByPhase || {
      [phase]: 1
    }
  },
  checks: [{
    id,
    phase,
    label,
    command: ['fixture:release-check'],
    cwd: '.',
    status,
    overridden: false,
    owner: null,
    startedAt: checkStartedAt,
    finishedAt: checkFinishedAt,
    durationMs: 0,
    exitCode: status === 'passed' ? 0 : 1,
    stdoutTail: '',
    stderrTail: '',
    artifacts: []
  }],
  ok: status === 'passed'
});

const createTuiReleaseReport = (root, target, overrides = {}) => createReleaseReport(root, {
  id: `tui.${target}.verify`,
  phase: 'install',
  label: `TUI ${target} verification`,
  runtimeTarget: target,
  ...overrides
});

const createTrustManifest = () => ({
  schemaVersion: 1,
  generatedAt: '2026-05-21T18:31:24Z',
  releaseVersion: '0.3.0',
  releaseTag: 'v0.3.0',
  checksumBundlePath: 'release-checksum-bundle.json',
  provenanceSummaryPath: 'provenance-summary.json',
  sboms: [
    { id: 'node-root', path: 'node-root.cyclonedx.json', format: 'cyclonedx-json' },
    { id: 'tui', path: 'tui.cyclonedx.json', format: 'cyclonedx-json' }
  ]
});

const createChecksumBundle = (sourceCommit = '0123456789abcdef0123456789abcdef01234567') => ({
  schemaVersion: 1,
  generatedAt: '2026-05-21T18:31:24Z',
  releaseVersion: '0.3.0',
  releaseTag: 'v0.3.0',
  sourceCommit,
  artifacts: [
    { path: 'dist/vscode/pairofcleats.vsix', sizeBytes: 10, sha256: 'a'.repeat(64) },
    { path: 'dist/sublime/pairofcleats.sublime-package', sizeBytes: 20, sha256: 'b'.repeat(64) }
  ]
});

const createProvenanceSummary = (sha = '0123456789abcdef0123456789abcdef01234567') => ({
  schemaVersion: 1,
  generatedAt: '2026-05-21T18:31:24Z',
  attestationProvider: 'github-actions-attest-build-provenance',
  workflow: 'Release',
  runId: '101',
  runAttempt: '1',
  repository: 'owner/repo',
  ref: 'refs/tags/v0.3.0',
  sha,
  releaseTag: 'v0.3.0',
  subjects: [
    'dist/release/bundle/release-artifacts.json',
    'dist/release/bundle/release-checksums.txt',
    'dist/release/trust/node-root.cyclonedx.json',
    'dist/release/trust/tui.cyclonedx.json'
  ]
});

const createCiStatuses = (sha, runIdBase) => ({
  schemaVersion: 1,
  generatedAt: '2026-05-21T18:31:24Z',
  targetSha: sha,
  workflows: [
    { workflow: 'CI', conclusion: 'success', runId: runIdBase + 1 },
    { workflow: 'CI Long', conclusion: 'success', runId: runIdBase + 2 }
  ]
});

const createCiSummary = () => ({
  summary: {
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    durationMs: 12
  },
  tests: [
    {
      id: 'ci/example',
      path: 'tests/ci/example.test.js',
      lane: 'ci',
      status: 'passed',
      durationMs: 12
    }
  ]
});

const createFailedCiSummary = () => ({
  summary: {
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    durationMs: 24
  },
  tests: [
    {
      id: 'ci/example',
      path: 'tests/ci/example.test.js',
      lane: 'ci',
      status: 'passed',
      durationMs: 12
    },
    {
      id: 'ci/failing',
      path: 'tests/ci/failing.test.js',
      lane: 'ci',
      status: 'failed',
      durationMs: 12
    }
  ]
});

const createRedoCiSummary = () => ({
  summary: {
    total: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
    durationMs: 24
  },
  tests: [
    {
      id: 'ci/example',
      path: 'tests/ci/example.test.js',
      lane: 'ci',
      status: 'passed',
      durationMs: 12
    },
    {
      id: 'ci/redo',
      path: 'tests/ci/redo.test.js',
      lane: 'ci',
      status: 'redo',
      durationMs: 12
    }
  ]
});

const writeTrustMaterials = (rootDir, {
  includeSboms = true,
  manifest = createTrustManifest(),
  sourceCommit = '0123456789abcdef0123456789abcdef01234567',
  sha = '0123456789abcdef0123456789abcdef01234567'
} = {}) => {
  writeJson(path.join(rootDir, 'trust-manifest.json'), manifest);
  writeJson(path.join(rootDir, 'provenance-summary.json'), createProvenanceSummary(sha));
  writeJson(path.join(rootDir, 'release-checksum-bundle.json'), createChecksumBundle(sourceCommit));
  if (includeSboms) {
    writeJson(path.join(rootDir, 'node-root.cyclonedx.json'), {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: []
    });
    writeJson(path.join(rootDir, 'tui.cyclonedx.json'), {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: []
    });
  }
};

export const setupReadinessGateFixture = async (
  cacheName = 'release-readiness-gate',
  { scenarios = ['all'] } = {}
) => {
  const root = process.cwd();
  const scriptPath = path.join(root, 'tools', 'release', 'readiness-gate.js');
  const { dir: fixtureDir } = await prepareTestCacheDir(cacheName);
  const releaseGitSha = '0123456789abcdef0123456789abcdef01234567';
  const scenarioSet = new Set(scenarios);
  const shouldPrepare = (scenario) => scenarioSet.has('all') || scenarioSet.has(scenario);

  const writeTuiReleaseReport = (rootDir, target, overrides = {}) => {
    writeJson(
      path.join(rootDir, target, 'release_check_report.json'),
      createTuiReleaseReport(root, target, overrides)
    );
  };

  const prepareReportPath = path.join(fixtureDir, 'prepare', 'release_check_report.json');
  const malformedPrepareReportPath = path.join(fixtureDir, 'prepare-malformed', 'release_check_report.json');
  const minimalPrepareReportPath = path.join(fixtureDir, 'prepare-minimal', 'release_check_report.json');
  const invalidTimestampPrepareReportPath = path.join(
    fixtureDir,
    'prepare-invalid-timestamp',
    'release_check_report.json'
  );
  const invalidAllTimestampsPrepareReportPath = path.join(
    fixtureDir,
    'prepare-invalid-all-timestamps',
    'release_check_report.json'
  );
  const invalidMissingByPhasePrepareReportPath = path.join(
    fixtureDir,
    'prepare-invalid-missing-by-phase',
    'release_check_report.json'
  );
  const runtimeReportPath = path.join(fixtureDir, 'runtime', 'release_check_report.json');
  const nodeVerifyReportPath = path.join(fixtureDir, 'node-verify', 'release_check_report.json');
  const tuiVerifyRoot = path.join(fixtureDir, 'tui');
  const invalidTimestampTuiVerifyRoot = path.join(fixtureDir, 'tui-invalid-timestamp');
  const mismatchedTuiVerifyRoot = path.join(fixtureDir, 'tui-mismatched-target');
  const minimalTuiVerifyRoot = path.join(fixtureDir, 'tui-minimal');
  const malformedTuiVerifyRoot = path.join(fixtureDir, 'tui-malformed-json');
  const trustRoot = path.join(fixtureDir, 'trust');
  const missingSbomTrustRoot = path.join(fixtureDir, 'trust-missing-sboms');
  const malformedTrustRoot = path.join(fixtureDir, 'trust-malformed');
  const malformedShapeTrustRoot = path.join(fixtureDir, 'trust-malformed-shape');
  const staleTrustRoot = path.join(fixtureDir, 'trust-stale-source');
  const ciStatusesPath = path.join(fixtureDir, 'ci-statuses.json');
  const malformedShapeCiStatusesPath = path.join(fixtureDir, 'ci-statuses-malformed-sha.json');
  const invalidShapeCiStatusesPath = path.join(fixtureDir, 'ci-statuses-invalid-shape.json');
  const upperCaseCiStatusesPath = path.join(fixtureDir, 'ci-statuses-uppercase-sha.json');
  const staleCiStatusesPath = path.join(fixtureDir, 'ci-statuses-stale.json');
  const malformedCiStatusesPath = path.join(fixtureDir, 'ci-statuses-malformed.json');
  const ciSummaryPath = path.join(fixtureDir, 'ci-quality', '.diagnostics', 'test-summary.json');
  const malformedCiSummaryPath = path.join(fixtureDir, 'ci-quality-malformed', '.diagnostics', 'test-summary.json');
  const invalidShapeCiSummaryPath = path.join(fixtureDir, 'ci-quality-invalid-shape', '.diagnostics', 'test-summary.json');
  const fractionalCountCiSummaryPath = path.join(
    fixtureDir,
    'ci-quality-fractional-counts',
    '.diagnostics',
    'test-summary.json'
  );
  const invalidRowCiSummaryPath = path.join(
    fixtureDir,
    'ci-quality-invalid-row',
    '.diagnostics',
    'test-summary.json'
  );
  const failedCiSummaryPath = path.join(fixtureDir, 'ci-quality-failed', '.diagnostics', 'test-summary.json');
  const redoCiSummaryPath = path.join(fixtureDir, 'ci-quality-redo', '.diagnostics', 'test-summary.json');
  const coverageDir = path.join(fixtureDir, 'ci-quality', '.diagnostics', 'coverage');
  const invalidShapeCoverageDir = path.join(fixtureDir, 'ci-quality-invalid-coverage', '.diagnostics', 'coverage');
  const semanticInvalidCoverageDir = path.join(
    fixtureDir,
    'ci-quality-semantic-invalid-coverage',
    '.diagnostics',
    'coverage'
  );
  const outJsonPath = path.join(fixtureDir, 'readiness', 'summary.json');
  const outMdPath = path.join(fixtureDir, 'readiness', 'summary.md');
  const outsideOutJsonPath = path.resolve(root, '..', `outside-release-readiness-${process.pid}.json`);
  const outsideOutMdPath = path.resolve(root, '..', `outside-release-readiness-${process.pid}.md`);

  writeJson(prepareReportPath, createReleaseReport(root, { id: 'prepare.fixture', phase: 'changelog' }));
  writeJson(runtimeReportPath, createReleaseReport(root, { id: 'runtime.fixture', phase: 'smoke' }));
  writeJson(nodeVerifyReportPath, createReleaseReport(root, { id: 'node-verify.fixture', phase: 'install' }));
  writeTuiReleaseReport(tuiVerifyRoot, 'ubuntu');
  writeTuiReleaseReport(tuiVerifyRoot, 'windows');
  writeTuiReleaseReport(tuiVerifyRoot, 'macos');
  writeTrustMaterials(trustRoot);
  writeJson(ciStatusesPath, createCiStatuses(releaseGitSha, 100));
  writeJson(ciSummaryPath, createCiSummary());
  fs.mkdirSync(coverageDir, { recursive: true });
  writeJson(path.join(coverageDir, 'test-coverage-ci.json'), {
    schemaVersion: 1,
    generatedAt: '2026-05-21T18:31:24Z',
    runId: 'run-ci',
    pathPolicy: 'repo-relative-posix',
    kind: 'v8-range-summary',
    summary: {
      files: 1,
      coveredRanges: 1,
      totalRanges: 1
    },
    entries: [{
      path: 'src/index.js',
      coveredRanges: 1,
      totalRanges: 1
    }]
  });
  if (shouldPrepare('reportShape')) {
    fs.mkdirSync(path.dirname(malformedPrepareReportPath), { recursive: true });
    fs.writeFileSync(malformedPrepareReportPath, '{ invalid json');
    writeJson(minimalPrepareReportPath, { ok: true });
    writeJson(invalidTimestampPrepareReportPath, createReleaseReport(root, {
      id: 'prepare.invalid-timestamp',
      phase: 'changelog',
      generatedAt: 'not an ISO timestamp'
    }));
    writeJson(invalidAllTimestampsPrepareReportPath, createReleaseReport(root, {
      id: 'prepare.invalid-all-timestamps',
      phase: 'changelog',
      startedAt: 'not-started-at',
      finishedAt: 'not-finished-at',
      checkStartedAt: 'not-check-started-at',
      checkFinishedAt: 'not-check-finished-at'
    }));
    writeJson(invalidMissingByPhasePrepareReportPath, createReleaseReport(root, {
      id: 'prepare.missing-by-phase',
      phase: 'changelog',
      summaryByPhase: {}
    }));
    writeTuiReleaseReport(invalidTimestampTuiVerifyRoot, 'ubuntu');
    writeTuiReleaseReport(invalidTimestampTuiVerifyRoot, 'windows');
    writeTuiReleaseReport(invalidTimestampTuiVerifyRoot, 'macos', {
      checkStartedAt: 'not-check-started-at'
    });
    writeTuiReleaseReport(mismatchedTuiVerifyRoot, 'ubuntu');
    writeTuiReleaseReport(mismatchedTuiVerifyRoot, 'windows');
    writeTuiReleaseReport(mismatchedTuiVerifyRoot, 'macos', {
      runtimeTarget: 'ubuntu'
    });
    writeJson(path.join(minimalTuiVerifyRoot, 'ubuntu', 'release_check_report.json'), { ok: true });
    writeJson(path.join(minimalTuiVerifyRoot, 'windows', 'release_check_report.json'), { ok: true });
    writeJson(path.join(minimalTuiVerifyRoot, 'macos', 'release_check_report.json'), { ok: true });
    writeTuiReleaseReport(malformedTuiVerifyRoot, 'ubuntu');
    writeTuiReleaseReport(malformedTuiVerifyRoot, 'windows');
    fs.mkdirSync(path.join(malformedTuiVerifyRoot, 'macos'), { recursive: true });
    fs.writeFileSync(path.join(malformedTuiVerifyRoot, 'macos', 'release_check_report.json'), '{ invalid json');
    writeTrustMaterials(missingSbomTrustRoot, { includeSboms: false });
    fs.mkdirSync(malformedTrustRoot, { recursive: true });
    fs.writeFileSync(path.join(malformedTrustRoot, 'trust-manifest.json'), '{ invalid json');
    writeJson(path.join(malformedTrustRoot, 'provenance-summary.json'), createProvenanceSummary());
    writeJson(path.join(malformedTrustRoot, 'release-checksum-bundle.json'), createChecksumBundle());
    writeTrustMaterials(malformedShapeTrustRoot, {
      manifest: {
        schemaVersion: 1
      }
    });
    fs.writeFileSync(malformedCiStatusesPath, '{ invalid json');
    writeJson(invalidShapeCiStatusesPath, {
      schemaVersion: 1,
      generatedAt: '2026-05-21T18:31:24Z',
      targetSha: releaseGitSha,
      workflows: [
        { workflow: 'CI', conclusion: 'success', runId: 1 },
        { workflow: 'CI Long', conclusion: 'success', runId: 'not-a-number' }
      ]
    });
    fs.mkdirSync(path.dirname(malformedCiSummaryPath), { recursive: true });
    fs.writeFileSync(malformedCiSummaryPath, '{ invalid json');
    writeJson(invalidShapeCiSummaryPath, { totals: { passed: 10, failed: 0 } });
  }

  if (shouldPrepare('ciQuality')) {
    writeTrustMaterials(staleTrustRoot, {
      sha: 'fedcba9876543210fedcba9876543210fedcba98',
      sourceCommit: 'fedcba9876543210fedcba9876543210fedcba98'
    });
    writeJson(staleCiStatusesPath, createCiStatuses('fedcba9876543210fedcba9876543210fedcba98', 200));
    writeJson(malformedShapeCiStatusesPath, createCiStatuses('not-a-git-sha', 300));
    writeJson(upperCaseCiStatusesPath, createCiStatuses(releaseGitSha.toUpperCase(), 400));
    writeJson(failedCiSummaryPath, createFailedCiSummary());
    writeJson(redoCiSummaryPath, createRedoCiSummary());
    writeJson(fractionalCountCiSummaryPath, {
      summary: {
        total: 1,
        passed: 0.5,
        failed: 0.5,
        skipped: 0,
        durationMs: 12
      },
      tests: [{
        id: 'ci/fractional-counts',
        path: 'tests/ci/fractional-counts.test.js',
        lane: 'ci',
        status: 'failed',
        durationMs: 12
      }]
    });
    writeJson(invalidRowCiSummaryPath, {
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        durationMs: 12
      },
      tests: [{
        id: 'ci/invalid-row',
        path: '../outside.test.js',
        lane: 'ci',
        status: 'unknown',
        durationMs: -1
      }]
    });
    fs.mkdirSync(invalidShapeCoverageDir, { recursive: true });
    fs.writeFileSync(path.join(invalidShapeCoverageDir, 'test-coverage-ci.json'), '{"coverage":true}\n');
    fs.mkdirSync(semanticInvalidCoverageDir, { recursive: true });
    writeJson(path.join(semanticInvalidCoverageDir, 'test-coverage-ci.json'), {
      schemaVersion: 1,
      generatedAt: '2026-05-21T18:31:24Z',
      runId: 'run-ci',
      pathPolicy: 'repo-relative-posix',
      kind: 'v8-range-summary',
      summary: {
        files: 1,
        coveredRanges: 1,
        totalRanges: 1
      },
      entries: [{
        path: '../outside.js',
        coveredRanges: 1,
        totalRanges: 1
      }]
    });
  }

  const baseArgs = [
    scriptPath,
    '--prepare-report',
    prepareReportPath,
    '--runtime-report',
    runtimeReportPath,
    '--node-verify-report',
    nodeVerifyReportPath,
    '--trust-root',
    trustRoot,
    '--ci-statuses',
    ciStatusesPath,
    '--ci-test-summary',
    ciSummaryPath,
    '--release-git-sha',
    releaseGitSha,
    '--coverage-dir',
    coverageDir,
    '--attested'
  ];

  return {
    root,
    scriptPath,
    fixtureDir,
    releaseGitSha,
    prepareReportPath,
    malformedPrepareReportPath,
    minimalPrepareReportPath,
    invalidTimestampPrepareReportPath,
    invalidAllTimestampsPrepareReportPath,
    invalidMissingByPhasePrepareReportPath,
    runtimeReportPath,
    nodeVerifyReportPath,
    tuiVerifyRoot,
    invalidTimestampTuiVerifyRoot,
    mismatchedTuiVerifyRoot,
    minimalTuiVerifyRoot,
    malformedTuiVerifyRoot,
    trustRoot,
    missingSbomTrustRoot,
    malformedTrustRoot,
    malformedShapeTrustRoot,
    staleTrustRoot,
    ciStatusesPath,
    malformedShapeCiStatusesPath,
    invalidShapeCiStatusesPath,
    upperCaseCiStatusesPath,
    staleCiStatusesPath,
    malformedCiStatusesPath,
    ciSummaryPath,
    malformedCiSummaryPath,
    invalidShapeCiSummaryPath,
    fractionalCountCiSummaryPath,
    invalidRowCiSummaryPath,
    failedCiSummaryPath,
    redoCiSummaryPath,
    coverageDir,
    invalidShapeCoverageDir,
    semanticInvalidCoverageDir,
    outJsonPath,
    outMdPath,
    outsideOutJsonPath,
    outsideOutMdPath,
    baseArgs,
    writeJson,
    writeTuiReleaseReport,
    createReleaseReport: (overrides = {}) => createReleaseReport(root, overrides),
    createTuiReleaseReport: (target, overrides = {}) => createTuiReleaseReport(root, target, overrides)
  };
};
