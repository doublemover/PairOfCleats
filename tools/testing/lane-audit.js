#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLaneAuditReport, formatLaneAuditReport } from '../../tests/runner/lane-audit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const report = await buildLaneAuditReport({ root: ROOT });
process.stdout.write(formatLaneAuditReport(report));

if (
  report.summary.missingIds
  || report.summary.duplicateIds
  || report.summary.manifestMismatches
  || report.summary.timingOverruns
) {
  process.exit(1);
}
