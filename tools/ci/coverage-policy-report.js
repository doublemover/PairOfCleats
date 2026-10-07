#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { validateTestCoverageArtifact, validateTestCoveragePolicyReportArtifact } from '../../src/contracts/validators/test-artifacts.js';
import { buildCoveragePolicyReport, writeCoveragePolicyReport } from '../testing/coverage/policy.js';

const parseArgs = () => createCli({
  scriptName: 'pairofcleats coverage-policy-report',
  options: {
    root: { type: 'string', default: '.' },
    coverage: { type: 'string' },
    out: { type: 'string' },
    markdown: { type: 'string', default: '' },
    mode: { type: 'string', default: '' },
    base: { type: 'string', default: '' },
    head: { type: 'string', default: '' }
  }
})
  .strictOptions()
  .parse();

const formatPercent = (value) => (
  value == null ? 'n/a' : `${(Number(value) * 100).toFixed(1)}%`
);

const main = async () => {
  const argv = parseArgs();
  const root = path.resolve(argv.root || '.');
  const coveragePath = path.resolve(root, argv.coverage);
  const outPath = path.resolve(root, argv.out);
  const markdownPath = String(argv.markdown || '').trim()
    ? path.resolve(root, argv.markdown)
    : '';

  const coverageArtifact = JSON.parse(await fs.readFile(coveragePath, 'utf8'));
  const coverageValidation = validateTestCoverageArtifact(coverageArtifact);
  if (!coverageValidation.ok) {
    console.error(`coverage policy report failed: invalid source coverage artifact: ${coverageValidation.errors.join('; ')}`);
    process.exit(1);
  }

  const report = buildCoveragePolicyReport({
    coverageArtifact,
    root,
    mode: argv.mode,
    baseRef: argv.base,
    headRef: argv.head
  });
  const reportValidation = validateTestCoveragePolicyReportArtifact(report);
  if (!reportValidation.ok) {
    console.error(`coverage policy report failed: invalid report artifact: ${reportValidation.errors.join('; ')}`);
    process.exit(1);
  }

  const written = await writeCoveragePolicyReport({
    report,
    outputPath: outPath,
    markdownPath
  });

  console.error(
    `[coverage-policy] overall=${formatPercent(report.overall.coverageFraction)} `
    + `changed=${formatPercent(report.changedFiles.summary.coverageFraction)} `
    + `strategy=${report.changedFiles.strategy}`
  );
  for (const surface of report.criticalSurfaces) {
    console.error(`[coverage-policy] ${surface.id}=${formatPercent(surface.summary.coverageFraction)}`);
  }
  console.log(JSON.stringify({
    outputPath: written.outputPath,
    markdownPath: written.markdownPath || null
  }, null, 2));
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
