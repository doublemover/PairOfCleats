#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeAwsInspector } from '../../../src/integrations/triage/normalize/aws-inspector.js';
import { renderRecordMarkdown } from '../../../src/integrations/triage/render.js';
import { promoteRecordFields } from '../../../src/integrations/triage/record-utils.js';
const raw = { findingArn: 'synthetic:stable', firstObservedAt: 1704067200.123, lastObservedAt: 0,
  packageVulnerabilityDetails: { vulnerabilityId: 'CVE-SYNTHETIC', vulnerablePackages: [
    { name: 'second', version: '2', fixedInVersion: '2.1', filePath: '/b' },
    { name: 'first', version: '1', fixedInVersion: '1.1', fixedVersion: 'wrong', filePath: '/a' }
  ] } };
const normalized = normalizeAwsInspector(raw);
assert.equal(normalized.createdAt, '2024-01-01T00:00:00.123Z');
assert.equal(normalized.updatedAt, '1970-01-01T00:00:00.000Z');
assert.equal(normalized.packages.length, 2);
assert.deepEqual(normalized.packages.map(pkg => pkg.fixedVersion), ['1.1', '2.1']);
assert.deepEqual(normalizeAwsInspector({ ...raw, packageVulnerabilityDetails: { ...raw.packageVulnerabilityDetails,
  vulnerablePackages: [...raw.packageVulnerabilityDetails.vulnerablePackages].reverse() } }).packages, normalized.packages);
const persisted = JSON.parse(JSON.stringify(normalized));
assert.match(renderRecordMarkdown(persisted), /second/);
assert.match(renderRecordMarkdown(persisted), /Fixed version: 2.1/);
assert.deepEqual(promoteRecordFields(persisted, ['packageName']).packageName, ['first', 'second']);
assert.ok(normalized.parseWarnings.some(warning => warning.includes('conflicting fixed version')));
assert.ok(normalizeAwsInspector({ ...raw, firstObservedAt: Infinity }).parseWarnings.some(warning => warning.includes('invalid AWS timestamp')));
