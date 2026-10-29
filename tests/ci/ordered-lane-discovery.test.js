import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildLaneAuditReport } from '../runner/lane-audit.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const report = await buildLaneAuditReport({ root });
assert.deepEqual(report.missingIds, [],
  'every ordered lane must reference discovered fixtures or declared case IDs');
assert.deepEqual(report.manifestMismatches, [],
  'every generated lane must preserve its ordered source exactly');
console.log(`Ordered fixture discovery and manifests agree across ${report.summary.lanes} lanes.`);
