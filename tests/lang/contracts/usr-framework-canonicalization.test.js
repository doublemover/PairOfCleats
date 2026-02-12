#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';
import { validateUsrEdgeEndpoint } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const bundlePath = path.join(repoRoot, 'tests', 'fixtures', 'usr', 'framework-canonicalization', 'usr-framework-canonicalization-bundle.json');
const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');
const frameworkEdgeCasesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-edge-cases.json');
const edgeConstraintsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-edge-kind-constraints.json');

const rawBundle = fs.readFileSync(bundlePath, 'utf8');
assert.equal(rawBundle.includes('//'), false, 'framework canonicalization bundle must not include comments');
assert.equal(rawBundle.includes('/*'), false, 'framework canonicalization bundle must not include block comments');

const bundle = JSON.parse(rawBundle);
const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));
const frameworkEdgeCases = JSON.parse(fs.readFileSync(frameworkEdgeCasesPath, 'utf8'));
const edgeConstraints = JSON.parse(fs.readFileSync(edgeConstraintsPath, 'utf8'));

assert.equal(bundle.schemaVersion, 'usr-1.0.0', 'framework canonicalization bundle schemaVersion must be usr-1.0.0');
assert.equal(bundle.fixtureId, 'usr-framework-canonicalization-bundle-v1', 'unexpected framework canonicalization fixtureId');

const frameworkRows = Array.isArray(frameworkProfiles.rows) ? frameworkProfiles.rows : [];
const expectedFrameworkIds = frameworkRows
  .filter((row) => Array.isArray(row.requiredConformance) && row.requiredConformance.includes('C4'))
  .map((row) => row.id)
  .sort();

const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
const actualFrameworkIds = rows.map((row) => row.frameworkProfile).sort();
assert.deepEqual(actualFrameworkIds, expectedFrameworkIds, 'framework canonicalization bundle must include all and only C4 framework profiles');

const frameworkRowById = new Map(frameworkRows.map((row) => [row.id, row]));
const edgeCaseRowById = new Map((frameworkEdgeCases.rows || []).map((row) => [row.id, row]));

const CANONICAL_SECTION35_EDGE_KINDS = new Set(['route_maps_to', 'template_binds', 'style_scopes']);
const SECTION35_REQUIRED_ATTRS = Object.freeze({
  route_maps_to: ['routePattern', 'router', 'runtimeSide'],
  template_binds: ['bindingKind', 'bindingName'],
  style_scopes: ['scopeKind', 'scopeType', 'styleSystem']
});

const seenFrameworkProfiles = new Set();
for (const row of rows) {
  const frameworkProfile = row.frameworkProfile;
  assert.equal(typeof frameworkProfile === 'string' && frameworkProfile.length > 0, true, 'row.frameworkProfile must be a non-empty string');
  assert.equal(seenFrameworkProfiles.has(frameworkProfile), false, `duplicate frameworkProfile row in canonicalization bundle: ${frameworkProfile}`);
  seenFrameworkProfiles.add(frameworkProfile);

  const profile = frameworkRowById.get(frameworkProfile);
  assert.equal(Boolean(profile), true, `framework canonicalization row references unknown profile: ${frameworkProfile}`);

  const edges = Array.isArray(row.edges) ? row.edges : [];
  assert.equal(edges.length > 0, true, `framework canonicalization row must include edges: ${frameworkProfile}`);

  const edgeKinds = new Set();
  for (const edge of edges) {
    assert.equal(edge.frameworkProfile, frameworkProfile, `edge.frameworkProfile must match row.frameworkProfile for ${frameworkProfile}`);
    assert.equal(CANONICAL_SECTION35_EDGE_KINDS.has(edge.kind), true, `section 35 fixture must only include canonical route/template/style edge kinds; received ${edge.kind}`);

    const endpointValidation = validateUsrEdgeEndpoint(edge, edgeConstraints);
    assert.equal(endpointValidation.ok, true, `edge endpoint validation failed for ${frameworkProfile}: ${endpointValidation.errors.join('; ')}`);

    const requiredAttrs = SECTION35_REQUIRED_ATTRS[edge.kind] || [];
    for (const attr of requiredAttrs) {
      const value = edge?.attrs?.[attr];
      assert.equal(typeof value === 'string' && value.trim().length > 0, true, `${frameworkProfile} ${edge.kind} edge must include non-empty attrs.${attr}`);
    }

    edgeKinds.add(edge.kind);
  }

  assert.equal(edgeKinds.has('template_binds'), true, `${frameworkProfile} must include at least one template_binds edge`);
  assert.equal(edgeKinds.has('style_scopes'), true, `${frameworkProfile} must include at least one style_scopes edge`);
  const routeEnabled = Boolean(profile?.routeSemantics?.enabled);
  assert.equal(edgeKinds.has('route_maps_to'), routeEnabled, `${frameworkProfile} route edge presence must match profile.routeSemantics.enabled`);

  const coveredEdgeCaseIds = Array.isArray(row.coveredEdgeCaseIds) ? row.coveredEdgeCaseIds : [];
  const uniqueCoveredEdgeCaseIds = new Set(coveredEdgeCaseIds);
  assert.equal(uniqueCoveredEdgeCaseIds.size, coveredEdgeCaseIds.length, `${frameworkProfile} coveredEdgeCaseIds must not contain duplicates`);

  const expectedEdgeCaseIds = Array.isArray(profile.edgeCaseCaseIds) ? profile.edgeCaseCaseIds : [];
  assert.deepEqual([...uniqueCoveredEdgeCaseIds].sort(), [...expectedEdgeCaseIds].sort(), `${frameworkProfile} coveredEdgeCaseIds must match framework profile edgeCaseCaseIds`);

  for (const edgeCaseId of expectedEdgeCaseIds) {
    const edgeCaseRow = edgeCaseRowById.get(edgeCaseId);
    assert.equal(Boolean(edgeCaseRow), true, `framework edge-case row missing: ${edgeCaseId}`);
    assert.equal(edgeCaseRow.frameworkProfile, frameworkProfile, `edge-case ${edgeCaseId} must belong to ${frameworkProfile}`);

    const requiredSection35Kinds = (edgeCaseRow.requiredEdgeKinds || [])
      .filter((edgeKind) => CANONICAL_SECTION35_EDGE_KINDS.has(edgeKind));
    for (const requiredKind of requiredSection35Kinds) {
      assert.equal(edgeKinds.has(requiredKind), true, `${frameworkProfile} must cover required section 35 edge kind ${requiredKind} for edge case ${edgeCaseId}`);
    }
  }
}

const canonicalHashA = sha1(stableStringify(bundle));
const canonicalHashB = sha1(stableStringify(JSON.parse(rawBundle)));
assert.equal(canonicalHashA, canonicalHashB, 'framework canonicalization fixture serialization hash must be stable across reruns');

console.log('usr framework canonicalization checks passed');
