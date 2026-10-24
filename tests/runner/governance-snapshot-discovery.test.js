#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGovernanceSnapshot } from './governance-snapshot.js';
import { generateLaneManifests } from './lane-manifests.js';
import { generateLaneEvidence } from './lane-evidence.js';
import { generateSuiteTaxonomyReport } from './suite-taxonomy-report.js';
import { buildLaneAuditReport } from './lane-audit.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
applyTestEnv();
const root = resolveTestCachePath(process.cwd(), 'governance-snapshot-discovery');
await fs.mkdir(path.join(root, 'tests/runner'), { recursive: true }); await fs.mkdir(path.join(root, 'docs/testing'), { recursive: true });
await fs.writeFile(path.join(root, 'tests/one.test.js'), '// discovery input');
await fs.writeFile(path.join(root, 'tests/one.test.js.cases.json'), JSON.stringify({ schemaVersion: 1, cases: ['first', 'second'] }));
await fs.writeFile(path.join(root, 'tests/run.rules.jsonc'), '{}');
await fs.writeFile(path.join(root, 'tests/gate.order.txt'), 'one/first\none/second\n');
await fs.writeFile(path.join(root, 'tests/runner/lane-manifests.jsonc'), JSON.stringify({ orderedLanes: { gate: { orderFile: 'tests/gate.order.txt', manifestFile: 'docs/testing/gate-manifest.json', timingArtifactPaths: [], targetMaxDurationSeconds: 15 } } }));
await fs.writeFile(path.join(root, 'docs/testing/consolidation-ownership.json'), JSON.stringify({ schemaVersion: 1, suites: [] }));
const readdir = fs.readdir, visits = new Map(); let snapshot;
try {
  fs.readdir = async (target, ...args) => { const key = path.resolve(String(target)); visits.set(key, (visits.get(key) || 0) + 1); return readdir(target, ...args); };
  snapshot = await createGovernanceSnapshot({ root });
  await generateLaneManifests({ root, snapshot });
  await generateLaneEvidence({ root, snapshot, historicalTimingsPath: path.join(root, 'missing-history.md'), outputJsonPath: path.join(root, 'evidence.json'), outputMarkdownPath: path.join(root, 'evidence.md') });
  await generateSuiteTaxonomyReport({ root, snapshot, outputJsonPath: path.join(root, 'taxonomy.json'), outputMarkdownPath: path.join(root, 'taxonomy.md') });
  const report = await buildLaneAuditReport({ root, snapshot }); assert.equal(report.summary.missingIds, 0); assert.equal(report.summary.manifestMismatches, 0);
} finally { fs.readdir = readdir; }
assert.ok([...visits.values()].every(count => count === 1), 'all refresh reports share one physical/logical discovery');
assert.deepEqual(snapshot.discovered.map(entry => entry.id), ['one/first', 'one/second']);
assert.throws(() => snapshot.discovered.push({}), TypeError);
await fs.writeFile(path.join(root, 'tests/two.test.js'), '// next invocation');
assert.equal(snapshot.discovered.length, 2);
const refreshed = await createGovernanceSnapshot({ root }); assert.equal(refreshed.discovered.length, 3);
await assert.rejects(buildLaneAuditReport({ root: path.join(root, 'other'), snapshot }), /root mismatch/);
