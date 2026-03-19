#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { resolveIndexDir } from '../../../src/retrieval/cli-index.js';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import {
  buildDiagnosticsReport,
  renderDiagnosticsReportHuman
} from '../../../tools/reports/diagnostics-report.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'diagnostics-report-risk');
const repoRoot = path.join(tempRoot, 'repo');
const indexDir = resolveIndexDir(repoRoot, 'code', loadUserConfig(repoRoot));
const contextPackPath = path.join(tempRoot, 'context-pack.json');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.mkdir(indexDir, { recursive: true });

await writeJsonObjectFile(path.join(indexDir, 'meta.json'), {
  fields: {
    version: 1,
    generatedAt: '2026-03-19T00:00:00.000Z'
  }
});
await writeJsonObjectFile(path.join(indexDir, 'risk_interprocedural_stats.json'), {
  fields: {
    schemaVersion: 1,
    generatedAt: '2026-03-19T00:00:00.000Z',
    status: 'ok',
    effectiveConfig: {
      enabled: true,
      summaryOnly: false
    },
    counts: {
      flowsEmitted: 0,
      partialFlowsEmitted: 0,
      uniqueCallSitesReferenced: 0
    },
    capsHit: ['maxFlows']
  }
});
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await writeJsonObjectFile(path.join(indexDir, 'pieces', 'manifest.json'), {
  fields: {
    version: 2,
    artifactSurfaceVersion: 'test',
    compatibilityKey: 'compat-diagnostics-risk',
    generatedAt: '2026-03-19T00:00:00.000Z',
    mode: 'code',
    stage: 'diagnostics-report-risk',
    pieces: [
      { name: 'risk_interprocedural_stats', path: 'risk_interprocedural_stats.json', format: 'json' }
    ]
  }
});

await fs.writeFile(contextPackPath, JSON.stringify({
  version: '1.0.0',
  risk: {
    status: 'ok',
    analysisStatus: {
      code: 'capped'
    },
    caps: {
      hits: ['maxFlows', 'maxStepsPerFlow'],
      observed: {
        omittedFlows: 2,
        omittedPartialFlows: 0
      }
    },
    truncation: [
      { scope: 'risk', cap: 'maxFlows', omitted: 2 },
      { scope: 'risk', cap: 'maxStepsPerFlow', omitted: 3 }
    ]
  }
}, null, 2));

const report = await buildDiagnosticsReport({
  reportKinds: 'risk-coverage,cap-heavy-risk-packs',
  repoRoot,
  contextPackPath
});

assert.equal(report.schemaVersion, 1, 'expected diagnostics report schema version');
assert.equal(report.reports.length, 2, 'expected both risk reports');

const coverage = report.reports.find((entry) => entry.kind === 'risk-coverage');
assert.ok(coverage, 'expected risk coverage report');
assert.equal(coverage.status, 'warn', 'expected missing flows and caps to surface as warning');
assert.equal(coverage.reasonCodes.includes('RISK_COVERAGE_FLOWS_MISSING'), true, 'expected missing flows reason');
assert.equal(coverage.reasonCodes.includes('RISK_COVERAGE_ZERO_FLOWS'), true, 'expected zero-flow reason');
assert.equal(coverage.reasonCodes.includes('RISK_COVERAGE_CAPPED'), true, 'expected capped risk reason');
assert.equal(Array.isArray(coverage.hints) && coverage.hints.length > 0, true, 'expected remediation hints');

const capHeavy = report.reports.find((entry) => entry.kind === 'cap-heavy-risk-packs');
assert.ok(capHeavy, 'expected cap-heavy risk pack report');
assert.equal(capHeavy.status, 'warn', 'expected capped pack to surface as warning');
assert.equal(capHeavy.reasonCodes.includes('RISK_PACK_CAPPED'), true, 'expected capped reason');
assert.equal(capHeavy.reasonCodes.includes('RISK_PACK_FLOWS_DROPPED'), true, 'expected dropped-flow reason');

const rendered = renderDiagnosticsReportHuman(report);
assert.equal(rendered.includes('Risk Coverage Quality [warn]'), true, 'expected rendered risk coverage section');
assert.equal(rendered.includes('Cap-Heavy Risk Packs [warn]'), true, 'expected rendered cap-heavy section');
assert.equal(rendered.includes('hint:'), true, 'expected rendered hints');

console.log('diagnostics report risk test passed');
