#!/usr/bin/env node
import assert from 'node:assert/strict';

import { assembleCompositeContextPack } from '../../src/context-pack/assemble.js';
import {
  CONTEXT_PACK_RISK_CONTRACT_VERSION,
  CONTEXT_PACK_RISK_SCHEMA_VERSION
} from '../../src/contracts/context-pack-risk-contract.js';
import { validateCompositeContextPack } from '../../src/contracts/validators/analysis.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { buildIndexSignature } from '../../src/retrieval/index-cache.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifactSync,
  MAX_JSON_BYTES,
  readCompatibilityKey
} from '../../src/shared/artifact-io.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();

const { fixtureRoot, codeDir } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'context-pack-public-risk-contract',
  cacheScope: 'isolated',
  requireRiskTags: true,
  requiredModes: ['code']
});

const summaries = loadJsonArrayArtifactSync(codeDir, 'risk_summaries', {
  maxBytes: MAX_JSON_BYTES,
  strict: true
});
const seedSummary = Array.isArray(summaries)
  ? summaries.find((entry) => typeof entry?.chunkUid === 'string' && entry.chunkUid)
  : null;
assert.ok(seedSummary?.chunkUid, 'expected fixture summary chunk');

const chunkMeta = await loadChunkMeta(codeDir, {
  maxBytes: MAX_JSON_BYTES,
  strict: true
});
const indexCompatKey = readCompatibilityKey(codeDir, {
  maxBytes: MAX_JSON_BYTES,
  strict: true
}).key;
const indexSignature = await buildIndexSignature(codeDir);

const pack = assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: seedSummary.chunkUid },
  chunkMeta,
  repoRoot: fixtureRoot,
  indexDir: codeDir,
  includeGraph: false,
  includeTypes: false,
  includeRisk: true,
  includeImports: false,
  includeUsages: false,
  includeCallersCallees: false,
  indexCompatKey,
  indexSignature
});

assert.equal(pack.risk?.version, CONTEXT_PACK_RISK_SCHEMA_VERSION, 'expected explicit risk schema version');
assert.equal(pack.risk?.contractVersion, CONTEXT_PACK_RISK_CONTRACT_VERSION, 'expected explicit risk contract version');
assert.equal(pack.risk?.provenance?.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION, 'expected current artifact surface version');

const valid = validateCompositeContextPack(pack);
assert.equal(valid.ok, true, `expected current pack to validate: ${valid.errors.join(', ')}`);

const missingContractVersion = structuredClone(pack);
delete missingContractVersion.risk.contractVersion;
const missingResult = validateCompositeContextPack(missingContractVersion);
assert.equal(missingResult.ok, false, 'expected missing risk contract version to fail');
assert.ok(missingResult.errors.some((entry) => /contractVersion/i.test(entry)), 'expected missing contract version error');

const unsupportedContractVersion = structuredClone(pack);
unsupportedContractVersion.risk.contractVersion = '2.0.0';
const unsupportedResult = validateCompositeContextPack(unsupportedContractVersion);
assert.equal(unsupportedResult.ok, false, 'expected unsupported risk contract version to fail');
assert.ok(
  unsupportedResult.errors.some((entry) => entry.includes(CONTEXT_PACK_RISK_CONTRACT_VERSION)),
  'expected unsupported contract version failure to mention accepted version'
);

const oldArtifactSurface = structuredClone(pack);
oldArtifactSurface.risk.provenance.artifactSurfaceVersion = '0.0.1';
const oldArtifactResult = validateCompositeContextPack(oldArtifactSurface);
assert.equal(oldArtifactResult.ok, false, 'expected unsupported artifact surface version to fail');
assert.ok(
  oldArtifactResult.errors.some((entry) => /artifactSurfaceVersion/.test(entry)),
  'expected unsupported artifact surface version error'
);

console.log('context pack public risk contract test passed');
