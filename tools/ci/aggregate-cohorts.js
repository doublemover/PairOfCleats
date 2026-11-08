import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateCaseReport } from './suite-cohorts.js';
import { buildCoverageArtifact } from '../testing/coverage/index.js';
import { mergeCoverageRanges } from '../testing/coverage/ranges.js';
import { validateTestCoverageArtifact } from '../../src/contracts/validators/test-artifacts.js';
import { assertCoverageSourceIdentity } from '../testing/coverage/source-identity.js';
import { buildTimingsPayload } from '../../tests/runner/run-reporting.js';
import { validateTestTimingsArtifact } from '../../src/contracts/validators/test-artifacts.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify every original assignment before merging evidence. A cancelled or
 * setup-failed job has no successful receipt and cannot disappear into green.
 */
export const verifyCohortReceipt = ({ plan, group, receipt, reports, outputs = new Map() }) => {
  if (receipt?.schemaVersion !== 1 || receipt.source !== plan.source || receipt.planDigest !== plan.digest
    || receipt.platform !== plan.platform || JSON.stringify(receipt.runtime) !== JSON.stringify(plan.runtime)
    || receipt.key !== group.key || receipt.ok !== true
    || !Number.isFinite(receipt.startedAt) || !Number.isFinite(receipt.finishedAt) || receipt.finishedAt < receipt.startedAt
    || JSON.stringify(receipt.completed) !== JSON.stringify(group.labels)) throw new Error(`Incomplete or foreign CI cohort: ${group.key}`);
  const expectedLabels = group.labels.filter(label => plan.stepCases[label].length);
  if (!Array.isArray(receipt.reports) || receipt.reports.length !== expectedLabels.length
    || new Set(receipt.reports.map(report => report.label)).size !== expectedLabels.length) throw new Error(`Incomplete report inventory: ${group.key}`);
  for (const label of expectedLabels) {
    const sealed = receipt.reports.find(report => report.label === label), actual = reports.get(label);
    if (!sealed || !actual || digest(actual.bytes) !== sealed.sha256) throw new Error(`Missing or changed original report: ${group.key}/${label}`);
    validateCaseReport(group.cohort === 'correctness' ? group.ids : plan.stepCases[label], actual.document, plan.presetSkips, plan.runtimeSkips);
  }
  const gateLabels = group.labels.filter(label => !plan.stepCases[label].length);
  if ((receipt.outputs || []).length !== gateLabels.length
    || new Set((receipt.outputs || []).map(output => output.label)).size !== gateLabels.length) throw new Error(`Incomplete gate output inventory: ${group.key}`);
  for (const label of gateLabels) {
    const sealed = receipt.outputs.find(output => output.label === label), actual = outputs.get(label);
    if (!sealed || !Array.isArray(sealed.files) || !sealed.files.length || !actual || actual.length !== sealed.files.length
      || sealed.files.some((file, index) => digest(actual[index]) !== file.sha256)) throw new Error(`Missing or changed gate result: ${group.key}/${label}`);
  }
};

const copyEvidence = async (source, target) => {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('CI evidence cannot contain filesystem aliases.');
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) await copyEvidence(from, to);
    else if (entry.isFile()) {
      try { await fs.access(to); throw new Error(`Duplicate copied evidence: ${entry.name}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.copyFile(from, to);
    }
  }
};

export const aggregatePlatformCohorts = async ({ plan, platformName, root = process.cwd(), artifactsRoot }) => {
  const errors = [], outcomes = [], correctnessReports = [], coverages = [];
  const destination = path.join(root, '.diagnostics');
  await fs.mkdir(path.join(destination, 'cohorts'), { recursive: true });
  const expectedArtifacts = plan.groups.map(group => `ci-${platformName}-${group.key}`);
  const actualArtifacts = await fs.readdir(artifactsRoot);
  for (const name of actualArtifacts) if (!expectedArtifacts.includes(name)) errors.push(`Unexpected cohort artifact: ${name}`);
  for (const group of plan.groups) {
    try {
      const artifact = path.join(artifactsRoot, `ci-${platformName}-${group.key}`);
      const diagnostics = path.join(artifact, '.diagnostics');
      await copyEvidence(diagnostics, path.join(destination, 'cohorts', group.key));
      try { await copyEvidence(path.join(artifact, '.testLogs'), path.join(root, '.testLogs', 'cohorts', group.key)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const receipt = JSON.parse(await fs.readFile(path.join(diagnostics, 'cohort-result.json'), 'utf8'));
      const reports = new Map();
      const readOutput = async file => {
        if (typeof file !== 'string' || !/^\.diagnostics\/[a-zA-Z0-9._/-]+$/.test(file)
          || file.split('/').some(part => part === '..' || !part)) throw new Error('Invalid CI report path.');
        return fs.readFile(path.join(artifact, file));
      };
      for (const sealed of receipt.reports || []) {
        const bytes = await readOutput(sealed.file);
        reports.set(sealed.label, { bytes, document: JSON.parse(bytes) });
      }
      const outputs = new Map();
      for (const sealed of receipt.outputs || []) {
        const bytes = await Promise.all(sealed.files.map(file => readOutput(file.file)));
        for (const value of bytes) JSON.parse(value);
        outputs.set(sealed.label, bytes);
      }
      verifyCohortReceipt({ plan, group, receipt, reports, outputs });
      if (group.cohort === 'correctness') {
        correctnessReports.push({ ...reports.get('CI test lane').document, startedAt: receipt.startedAt, finishedAt: receipt.finishedAt });
        const coverageBytes = await fs.readFile(path.join(diagnostics, 'coverage/test-coverage-ci.json'));
        const rangeBytes = await fs.readFile(path.join(diagnostics, 'coverage/test-coverage-ci.json.ranges.json'));
        if (digest(coverageBytes) !== receipt.coverage?.summary || digest(rangeBytes) !== receipt.coverage?.ranges) throw new Error('Shard coverage changed after original completion.');
        const coverage = JSON.parse(coverageBytes), ranges = JSON.parse(rangeBytes);
        const validation = validateTestCoverageArtifact(coverage);
        if (!validation.ok) throw new Error('Invalid shard coverage: ' + validation.errors.join('; '));
        assertCoverageSourceIdentity(coverage);
        if (JSON.stringify(mergeCoverageRanges([ranges])) !== JSON.stringify(coverage.entries)) throw new Error('Shard coverage summary differs from original ranges.');
        coverages.push(ranges);
      } else {
        // Preserve original quality-artifact paths used by release acceptance.
        const promoted = new Set(receipt.reports.map(report => path.posix.basename(report.file)));
        if (group.cohort === 'usr') promoted.add('usr');
        if (group.cohort === 'tooling') for (const file of ['capabilities.json', 'tooling-doctor-gate.json',
          'tooling-lsp-slo-gate.json', 'tooling-lsp-replay-gate.json', 'tooling-lsp-default-enable-gate.json',
          'tooling-lsp-guardrail.json', 'import-resolution-slo-gate.json', 'jj-provisioning.json',
          'go-sdk.json', 'gopls-provisioning.json', 'gopls-startup.json', 'dotnet-sdk.json',
          'csharp-ls-provisioning.json', 'csharp-ls-startup.json', 'php-sdk.json',
          'phpactor-provisioning.json', 'phpactor-startup.json', 'phpactor-platform.json']) promoted.add(file);
        for (const entry of await fs.readdir(diagnostics, { withFileTypes: true })) {
          if (!promoted.has(entry.name)) continue;
          const from = path.join(diagnostics, entry.name), to = path.join(destination, entry.name);
          if (entry.isDirectory()) await copyEvidence(from, to);
          else if (entry.isFile()) {
            try { await fs.access(to); throw new Error(`Duplicate promoted diagnostic: ${entry.name}`); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            await fs.copyFile(from, to);
          }
        }
      }
      outcomes.push({ key: group.key, ok: true, cases: group.ids.length });
    } catch (error) {
      errors.push(`${group.key}: ${error.message}`); outcomes.push({ key: group.key, ok: false });
    }
  }
  const correctnessComplete = correctnessReports.length === 4 && coverages.length === 4
    && outcomes.filter(outcome => outcome.key.startsWith('correctness-') && outcome.ok).length === 4;
  if (correctnessComplete) {
    const tests = correctnessReports.flatMap(report => report.tests);
    if (new Set(tests.map(test => test.id)).size !== tests.length
      || tests.length !== plan.stepCases['CI test lane'].length) throw new Error('Merged correctness inventory differs from its original selection.');
    const summary = { durationMs: Math.max(...correctnessReports.map(report => report.finishedAt)) - Math.min(...correctnessReports.map(report => report.startedAt)),
      failed: 0, passed: tests.filter(test => test.status === 'passed').length,
      skipped: tests.filter(test => test.status === 'skipped').length, total: tests.length };
    await fs.writeFile(path.join(destination, 'test-summary.json'), JSON.stringify({ summary, tests }, null, 2) + '\n');
    const timings = buildTimingsPayload({ results: tests.map(test => ({ ...test, relPath: test.path })),
      totalMs: summary.durationMs, runId: `ci-${plan.source}-${platformName}` });
    const timingValidation = validateTestTimingsArtifact(timings);
    if (!timingValidation.ok) throw new Error('Invalid merged timings: ' + timingValidation.errors.join('; '));
    await fs.writeFile(path.join(destination, 'test-timings.json'), JSON.stringify(timings, null, 2) + '\n');
    const xml = [];
    for (const group of plan.groups.filter(group => group.cohort === 'correctness')) {
      const original = await fs.readFile(path.join(artifactsRoot, `ci-${platformName}-${group.key}`, '.testLogs/junit.xml'), 'utf8');
      const suites = [...original.matchAll(/<testsuite\s[\s\S]*?<\/testsuite>/g)].map(match => match[0]);
      if (!suites.length) throw new Error(`Missing original JUnit suite: ${group.key}`);
      xml.push(...suites);
    }
    await fs.mkdir(path.join(root, '.testLogs'), { recursive: true });
    await fs.writeFile(path.join(root, '.testLogs/junit.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${xml.join('\n')}\n</testsuites>\n`);
    await fs.mkdir(path.join(destination, 'coverage'), { recursive: true });
    const coverage = buildCoverageArtifact({ runId: `ci-${plan.source}-${platformName}`, entries: mergeCoverageRanges(coverages) });
    await fs.writeFile(path.join(destination, 'coverage/test-coverage-ci.json'), JSON.stringify(coverage, null, 2) + '\n');
    await fs.mkdir(path.join(root, '.cache/ci-timings'), { recursive: true });
    await fs.writeFile(path.join(root, '.cache/ci-timings/correctness.json'), JSON.stringify(Object.fromEntries(tests
      .filter(test => test.status === 'passed').map(test => [test.id, test.durationMs])), null, 2) + '\n');
  }
  return { schemaVersion: 1, source: plan.source, planDigest: plan.digest, platform: plan.platform,
    ok: errors.length === 0 && outcomes.length === plan.groups.length, correctnessComplete, outcomes, errors };
};
