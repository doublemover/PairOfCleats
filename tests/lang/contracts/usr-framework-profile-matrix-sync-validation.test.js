#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const frameworkProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-profiles.json');
const frameworkEdgeCasesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-framework-edge-cases.json');
const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');

const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));
const frameworkEdgeCases = JSON.parse(fs.readFileSync(frameworkEdgeCasesPath, 'utf8'));
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));

const frameworkRows = Array.isArray(frameworkProfiles.rows) ? frameworkProfiles.rows : [];
const edgeCaseRows = Array.isArray(frameworkEdgeCases.rows) ? frameworkEdgeCases.rows : [];
const languageRows = Array.isArray(languageProfiles.rows) ? languageProfiles.rows : [];

const languageIds = new Set(languageRows.map((row) => row.id));
const frameworkIds = new Set(frameworkRows.map((row) => row.id));

assert.equal(frameworkRows.length > 0, true, 'framework profile registry must contain rows');
assert.equal(edgeCaseRows.length > 0, true, 'framework edge-case registry must contain rows');

const languageFrameworkInverse = new Map();
for (const languageRow of languageRows) {
  for (const frameworkId of languageRow.frameworkProfiles || []) {
    if (!languageFrameworkInverse.has(frameworkId)) languageFrameworkInverse.set(frameworkId, new Set());
    languageFrameworkInverse.get(frameworkId).add(languageRow.id);
  }
}

const edgeCaseById = new Map();
for (const edgeCaseRow of edgeCaseRows) {
  assert.equal(edgeCaseById.has(edgeCaseRow.id), false, `duplicate framework edge-case id: ${edgeCaseRow.id}`);
  edgeCaseById.set(edgeCaseRow.id, edgeCaseRow);
}

const REQUIRED_ATTRS_BY_EDGE_KIND = Object.freeze({
  template_binds: ['bindingKind'],
  template_emits: ['eventKind'],
  style_scopes: ['scopeKind'],
  route_maps_to: ['routePattern', 'runtimeSide'],
  hydration_boundary: ['runtimeSide']
});

for (const row of frameworkRows) {
  assert.equal(typeof row.id === 'string' && row.id.length > 0, true, 'framework row id must be non-empty string');

  const requiredConformance = row.requiredConformance || [];
  assert.equal(requiredConformance.includes('C4'), true, `framework profile must include C4 conformance requirement: ${row.id}`);

  const appliesToLanguages = row.appliesToLanguages || [];
  assert.equal(appliesToLanguages.length > 0, true, `framework profile must declare appliesToLanguages: ${row.id}`);
  for (const languageId of appliesToLanguages) {
    assert.equal(languageIds.has(languageId), true, `framework appliesToLanguages references unknown language: ${row.id} -> ${languageId}`);
  }

  const inverseLanguageSet = languageFrameworkInverse.get(row.id) || new Set();
  assert.deepEqual([...inverseLanguageSet].sort(), [...new Set(appliesToLanguages)].sort(), `framework-language mapping must be bidirectional: ${row.id}`);

  const blocks = new Set(row?.segmentationRules?.blocks || []);
  assert.equal(blocks.size > 0, true, `framework segmentationRules.blocks must be non-empty: ${row.id}`);

  const requiredEdgeKinds = row?.bindingSemantics?.requiredEdgeKinds || [];
  const requiredEdgeKindSet = new Set(requiredEdgeKinds);
  assert.equal(requiredEdgeKinds.length, requiredEdgeKindSet.size, `framework requiredEdgeKinds must not contain duplicates: ${row.id}`);

  for (const edgeKind of requiredEdgeKinds) {
    const requiredAttrs = row?.bindingSemantics?.requiredAttrs?.[edgeKind] || [];
    const requiredAttrSet = new Set(requiredAttrs);
    assert.equal(requiredAttrs.length, requiredAttrSet.size, `framework requiredAttrs must not contain duplicates: ${row.id}.${edgeKind}`);
    for (const attrName of REQUIRED_ATTRS_BY_EDGE_KIND[edgeKind] || []) {
      assert.equal(requiredAttrSet.has(attrName), true, `framework requiredAttrs missing canonical attr: ${row.id}.${edgeKind}.${attrName}`);
    }
  }

  const routeEnabled = Boolean(row?.routeSemantics?.enabled);
  assert.equal(requiredEdgeKindSet.has('route_maps_to'), routeEnabled, `route_maps_to presence must match routeSemantics.enabled: ${row.id}`);
  if (routeEnabled) {
    const runtimeSides = new Set(row?.routeSemantics?.runtimeSides || []);
    for (const side of ['client', 'server', 'universal', 'unknown']) {
      assert.equal(runtimeSides.has(side), true, `route runtime side missing for ${row.id}: ${side}`);
    }
  }

  const hydrationRequired = Boolean(row?.hydrationSemantics?.required);
  assert.equal(requiredEdgeKindSet.has('hydration_boundary'), hydrationRequired, `hydration_boundary presence must match hydrationSemantics.required: ${row.id}`);

  const bridges = row.embeddedLanguageBridges || [];
  for (const bridge of bridges) {
    assert.equal(typeof bridge.sourceBlock === 'string' && bridge.sourceBlock.length > 0, true, `bridge.sourceBlock must be non-empty: ${row.id}`);
    assert.equal(typeof bridge.targetBlock === 'string' && bridge.targetBlock.length > 0, true, `bridge.targetBlock must be non-empty: ${row.id}`);
    assert.equal(blocks.has(bridge.sourceBlock), true, `bridge.sourceBlock must exist in segmentation blocks: ${row.id} -> ${bridge.sourceBlock}`);
    assert.equal(blocks.has(bridge.targetBlock), true, `bridge.targetBlock must exist in segmentation blocks: ${row.id} -> ${bridge.targetBlock}`);
    for (const edgeKind of bridge.edgeKinds || []) {
      assert.equal(requiredEdgeKindSet.has(edgeKind), true, `bridge edge kind must exist in binding requiredEdgeKinds: ${row.id} -> ${edgeKind}`);
    }
  }

  const edgeCaseIds = row.edgeCaseCaseIds || [];
  const edgeCaseIdSet = new Set(edgeCaseIds);
  assert.equal(edgeCaseIds.length, edgeCaseIdSet.size, `edgeCaseCaseIds must not contain duplicates: ${row.id}`);
  assert.equal(edgeCaseIds.length > 0, true, `framework profile must declare edgeCaseCaseIds: ${row.id}`);

  for (const edgeCaseId of edgeCaseIds) {
    const edgeCaseRow = edgeCaseById.get(edgeCaseId);
    assert.equal(Boolean(edgeCaseRow), true, `framework profile references unknown edge-case row: ${row.id} -> ${edgeCaseId}`);
    assert.equal(edgeCaseRow.frameworkProfile, row.id, `edge-case must point back to owning framework profile: ${edgeCaseId}`);

    for (const edgeKind of edgeCaseRow.requiredEdgeKinds || []) {
      assert.equal(requiredEdgeKindSet.has(edgeKind), true, `edge-case requiredEdgeKind not present in framework binding semantics: ${edgeCaseId} -> ${edgeKind}`);
    }

    if (edgeCaseRow.category === 'route') {
      assert.equal(routeEnabled, true, `route edge-case requires routeSemantics.enabled=true: ${edgeCaseId}`);
    }

    if (edgeCaseRow.category === 'hydration') {
      assert.equal(hydrationRequired, true, `hydration edge-case requires hydrationSemantics.required=true: ${edgeCaseId}`);
    }
  }
}

for (const edgeCaseRow of edgeCaseRows) {
  assert.equal(frameworkIds.has(edgeCaseRow.frameworkProfile), true, `edge-case references unknown framework profile: ${edgeCaseRow.id} -> ${edgeCaseRow.frameworkProfile}`);
}

console.log('usr framework profile matrix sync validation checks passed');
