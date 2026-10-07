#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { generateLaneManifests } from '../../tests/runner/lane-manifests.js';
import { generateLaneEvidence } from '../../tests/runner/lane-evidence.js';
import { generateSuiteTaxonomyReport } from '../../tests/runner/suite-taxonomy-report.js';
import { buildLaneAuditReport, formatLaneAuditReport } from '../../tests/runner/lane-audit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const runNodeScript = (scriptPath) => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`refresh-governance step failed: ${scriptPath}`);
  }
};

const main = async () => {
  const { manifests } = await generateLaneManifests({ root: ROOT });
  for (const [lane, manifest] of manifests.entries()) {
    process.stdout.write(
      `manifest\t${lane}\t${manifest.tests.length}\t${path.relative(ROOT, manifest.manifestPath).replace(/\\/g, '/')}\n`
    );
  }

  const laneEvidence = await generateLaneEvidence({ root: ROOT });
  process.stdout.write(`lane-evidence\t${path.relative(ROOT, laneEvidence.outputMarkdownPath).replace(/\\/g, '/')}\n`);

  const taxonomy = await generateSuiteTaxonomyReport({ root: ROOT });
  process.stdout.write(`suite-taxonomy\t${path.relative(ROOT, taxonomy.outputMarkdownPath).replace(/\\/g, '/')}\n`);

  runNodeScript(path.join(ROOT, 'tools', 'config', 'inventory.js'));
  runNodeScript(path.join(ROOT, 'tools', 'docs', 'shared-module-ledger.js'));

  const laneAudit = await buildLaneAuditReport({ root: ROOT });
  process.stdout.write(formatLaneAuditReport(laneAudit));
  if (
    laneAudit.summary.missingIds
    || laneAudit.summary.duplicateIds
    || laneAudit.summary.manifestMismatches
    || laneAudit.summary.timingOverruns
  ) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
