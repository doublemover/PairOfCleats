import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDiagnosticsReport } from '../../../tools/reports/diagnostics-report.js';
import { buildRiskAnalysisStatus, withRiskContractVersion } from '../../../src/context-pack/assemble/risk-load.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: selection must fail before unrelated config/artifact inspection;
// report-only CLI output remains successful for valid warning/error reports.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const invalid = {
  unknown: ['queue-helth', /Unsupported diagnostics report/],
  empty: ['', /nonempty/],
  'empty-member': ['queue-health,', /Unsupported diagnostics report/],
  'non-string': [[], /nonempty/],
  'mixed-all': ['all,queue-health', /Select all alone/],
  'no-input': [undefined, /No diagnostics reports selected/],
  'missing-repo': ['risk-coverage', /requires a repository/],
  'missing-pack': ['cap-heavy-risk-packs', /requires a context-pack/]
};
assert.ok(Object.hasOwn(invalid, selected) || ['selection-before-config', 'duplicate-selection', 'cli-warning', 'cli-error-report', 'cli-invalid'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'diagnostics-selection-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  if (Object.hasOwn(invalid, selected)) {
    const [reportKinds, pattern] = invalid[selected];
    await assert.rejects(buildDiagnosticsReport({ reportKinds }), pattern);
  } else if (selected === 'selection-before-config') {
    const configPath = path.join(root, 'invalid-service.json');
    await fs.writeFile(configPath, '{invalid');
    await assert.rejects(buildDiagnosticsReport({ reportKinds: 'unknown', configPath }), /Unsupported diagnostics report/);
  } else if (selected === 'duplicate-selection') {
    const report = await buildDiagnosticsReport({ reportKinds: 'QUEUE-HEALTH,queue-health' });
    assert.equal(report.reports.length, 1);
    assert.equal(report.reports[0].kind, 'queue-health');
    assert.equal(report.inputs.configPath, path.join(root, 'cache', 'service', 'config.json'));
  } else {
    const contextPackPath = path.join(root, 'pack.json');
    const code = selected === 'cli-error-report' ? 'missing' : 'disabled';
    await fs.writeFile(contextPackPath, JSON.stringify({ risk: withRiskContractVersion({
      version: 1, status: code, reason: `producer-${code}`, caps: { hits: [], observed: {} }, truncation: [],
      analysisStatus: buildRiskAnalysisStatus({ status: code, code, reason: `producer-${code}`,
        degraded: code === 'missing', summaryOnly: false, strictFailure: true, artifactStatus: {}, stats: {}, caps: {}, degradedReasons: [] })
    }) }));
    const cli = path.resolve('tools/reports/diagnostics-report.js');
    const result = spawnSync(process.execPath, [cli, '--report', selected === 'cli-invalid' ? 'unsupported' : 'cap-heavy-risk-packs',
      '--context-pack', contextPackPath, '--json'], { cwd: root, env: process.env, windowsHide: true, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined);
    if (selected === 'cli-invalid') {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unsupported diagnostics report/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const report = JSON.parse(result.stdout);
      assert.equal(report.summary.status, code === 'missing' ? 'error' : 'warn');
      assert.equal(report.reports[0].summary.analysisCode, code);
      assert.equal(report.reports[0].summary.reason, `producer-${code}`);
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`diagnostics report selection ${selected} passed`);
