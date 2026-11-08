import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { discoverReportStreams, createReportStreamContext } from '../../tools/bench/language/report-streams.js';
import { buildBenchParityCoverage } from '../../tools/bench/language/report-coverage.js';
import { rmDirRecursive } from './temp.js';

/** Real captured quiet file-pair observations for schema-only report fixtures.
 * This does not represent a benchmark run, runtime readiness or performance.
 */
export const withBenchParitySources = async callback => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url)), base = path.join(repoRoot, '.tmp', 'tests', 'bench-parity-sources');
  assertNoSymlinkPath(repoRoot, base, { allowMissing: true }); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-')), logsRoot = path.join(root, 'logs', 'bench-language');
  await fs.mkdir(logsRoot, { recursive: true });
  const logPath = path.join(logsRoot, 'run-fixture-all.log'), diagnosticPath = path.join(logsRoot, 'run-fixture-all.diagnostics.jsonl');
  const writeQuiet = async () => { await fs.writeFile(logPath, 'Quiet fixture source; no classified diagnostic events.\n'); await fs.writeFile(diagnosticPath, ''); };
  const captureQuiet = async () => {
    const inventory = await discoverReportStreams(root), context = createReportStreamContext(inventory);
    for (const entry of inventory.entries) await context.consume(entry.path, () => { assert.notEqual(entry.path, diagnosticPath, 'quiet diagnostic fixture must remain actually empty'); });
    return buildBenchParityCoverage({ tasks: [], logFiles: context.files('.log'), diagnosticFiles: context.files('.diagnostics.jsonl'),
      diagnosticsStream: { malformedLines: 0, unknownTypeCount: 0 }, streamRead: context.summary() });
  };
  try { return await callback({ root, logsRoot, logPath, diagnosticPath, writeQuiet, captureQuiet }); }
  finally {
    assertNoSymlinkPath(repoRoot, root); const actual = await fs.realpath(root), parent = await fs.realpath(base);
    assert.equal(path.dirname(actual), parent); await rmDirRecursive(actual, { retries: 0 });
  }
};
export const observedQuietBenchParity = () => withBenchParitySources(async source => { await source.writeQuiet(); return source.captureQuiet(); });
