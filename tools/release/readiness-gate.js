#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { resolveRepoRootArg } from '../shared/dict-utils.js';
import { toIso } from './metadata-support.js';

const argv = createCli({
  scriptName: 'pairofcleats release readiness-gate',
  options: {
    'prepare-report': { type: 'string', default: '' },
    'runtime-report': { type: 'string', default: '' },
    'node-verify-report': { type: 'string', default: '' },
    'tui-verify-root': { type: 'string', default: '' },
    'trust-root': { type: 'string', default: '' },
    'ci-statuses': { type: 'string', default: '' },
    'ci-test-summary': { type: 'string', default: '' },
    'coverage-dir': { type: 'string', default: '' },
    'attested': { type: 'boolean', default: false },
    'out-json': { type: 'string', default: 'dist/release/readiness/readiness-summary.json' },
    'out-md': { type: 'string', default: 'dist/release/readiness/readiness-summary.md' }
  }
}).parse();

const root = resolveRepoRootArg(null, process.cwd());

const resolveOptionalPath = (value) => {
  const text = String(value || '').trim();
  return text ? path.resolve(root, text) : '';
};

const prepareReportPath = resolveOptionalPath(argv['prepare-report']);
const runtimeReportPath = resolveOptionalPath(argv['runtime-report']);
const nodeVerifyReportPath = resolveOptionalPath(argv['node-verify-report']);
const tuiVerifyRoot = resolveOptionalPath(argv['tui-verify-root']);
const trustRoot = resolveOptionalPath(argv['trust-root']);
const ciStatusesPath = resolveOptionalPath(argv['ci-statuses']);
const ciTestSummaryPath = resolveOptionalPath(argv['ci-test-summary']);
const coverageDir = resolveOptionalPath(argv['coverage-dir']);
const outJsonPath = path.resolve(root, String(argv['out-json'] || 'dist/release/readiness/readiness-summary.json'));
const outMdPath = path.resolve(root, String(argv['out-md'] || 'dist/release/readiness/readiness-summary.md'));

const toPosixRelative = (filePath) => path.relative(root, filePath).replace(/\\/g, '/');

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const readJsonIfExists = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const collectFiles = (dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const files = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const resolved = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(resolved);
        continue;
      }
      files.push(resolved);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
};

const collectTuiReports = (dirPath) => collectFiles(dirPath)
  .filter((filePath) => /release_check_report\.json$/i.test(path.basename(filePath)))
  .map((filePath) => ({
    path: toPosixRelative(filePath),
    payload: JSON.parse(fs.readFileSync(filePath, 'utf8'))
  }));

const blockers = [];
const addBlocker = (id, detail) => blockers.push({ id, detail });

const assertReleaseReport = (label, filePath, payload) => {
  if (!filePath || !payload) {
    addBlocker(`${label}.missing`, `${label} report is missing.`);
    return { ok: false, path: filePath ? toPosixRelative(filePath) : null };
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
  const prepareReport = readJsonIfExists(prepareReportPath);
  const runtimeReport = readJsonIfExists(runtimeReportPath);
  const nodeVerifyReport = readJsonIfExists(nodeVerifyReportPath);
  const tuiReports = collectTuiReports(tuiVerifyRoot);
  const trustManifest = readJsonIfExists(trustRoot ? path.join(trustRoot, 'trust-manifest.json') : '');
  const provenanceSummary = readJsonIfExists(trustRoot ? path.join(trustRoot, 'provenance-summary.json') : '');
  const checksumBundle = readJsonIfExists(trustRoot ? path.join(trustRoot, 'release-checksum-bundle.json') : '');
  const ciStatuses = readJsonIfExists(ciStatusesPath);
  const ciTestSummary = readJsonIfExists(ciTestSummaryPath);
  const coverageFiles = collectFiles(coverageDir);

  const releaseChecks = {
    prepare: assertReleaseReport('prepare', prepareReportPath, prepareReport),
    runtime: assertReleaseReport('runtime', runtimeReportPath, runtimeReport),
    nodeVerify: assertReleaseReport('nodeVerify', nodeVerifyReportPath, nodeVerifyReport),
    tuiVerify: {
      ok: tuiReports.length > 0 && tuiReports.every((entry) => entry.payload?.ok === true),
      reports: tuiReports.map((entry) => ({ path: entry.path, ok: entry.payload?.ok === true }))
    }
  };
  if (!releaseChecks.tuiVerify.ok) {
    addBlocker('tuiVerify.failed', 'one or more TUI verification reports are missing or failed.');
  }

  const trustChecks = {
    trustManifest: Boolean(trustManifest),
    provenanceSummary: Boolean(provenanceSummary),
    checksumBundle: Boolean(checksumBundle),
    attested: argv.attested === true
  };
  for (const [key, ok] of Object.entries(trustChecks)) {
    if (!ok) {
      addBlocker(`trust.${key}`, `required trust material ${key} is missing or false.`);
    }
  }

  const requiredCiWorkflows = ['CI', 'CI Long'];
  const ciWorkflowStatuses = requiredCiWorkflows.map((workflowName) => {
    const runEntry = Array.isArray(ciStatuses?.workflows)
      ? ciStatuses.workflows.find((entry) => entry.workflow === workflowName)
      : null;
    const success = runEntry?.conclusion === 'success';
    if (!success) {
      addBlocker(`ci.${workflowName.replace(/\s+/g, '-').toLowerCase()}`, `${workflowName} is not successful for this commit.`);
    }
    return {
      workflow: workflowName,
      success,
      runId: runEntry?.runId || null,
      conclusion: runEntry?.conclusion || null
    };
  });

  const coverageReady = coverageFiles.length > 0;
  if (!coverageReady) {
    addBlocker('coverage.missing', 'coverage artifact directory is missing or empty.');
  }
  const testSummaryReady = Boolean(ciTestSummary?.totals || ciTestSummary?.summary);
  if (!testSummaryReady) {
    addBlocker('ci.test-summary', 'CI test summary artifact is missing or invalid.');
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
      testSummaryPath: ciTestSummaryPath ? toPosixRelative(ciTestSummaryPath) : null,
      coverageDir: coverageDir ? toPosixRelative(coverageDir) : null,
      coverageFiles: coverageFiles.map((filePath) => toPosixRelative(filePath))
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
    `- trust manifest: ${trustChecks.trustManifest ? 'present' : 'missing'}`,
    `- provenance summary: ${trustChecks.provenanceSummary ? 'present' : 'missing'}`,
    `- checksum bundle: ${trustChecks.checksumBundle ? 'present' : 'missing'}`,
    `- attestation: ${trustChecks.attested ? 'ready' : 'missing'}`,
    '',
    '## CI',
    '',
    ...ciWorkflowStatuses.map((entry) => `- ${entry.workflow}: ${entry.success ? 'success' : 'missing/failing'}${entry.runId ? ` (run ${entry.runId})` : ''}`),
    `- test summary: ${testSummaryReady ? 'present' : 'missing'}`,
    `- coverage files: ${coverageFiles.length}`,
    '',
    '## Blockers',
    '',
    ...(blockers.length > 0
      ? blockers.map((blocker) => `- ${blocker.id}: ${blocker.detail}`)
      : ['- none'])
  ].join('\n');

  ensureParentDir(outJsonPath);
  ensureParentDir(outMdPath);
  fs.writeFileSync(outJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(outMdPath, `${markdown}\n`);

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
