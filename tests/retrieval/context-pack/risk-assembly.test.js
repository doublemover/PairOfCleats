#!/usr/bin/env node
import assert from 'node:assert/strict';

import { assembleCompositeContextPack } from '../../../src/context-pack/assemble.js';
import { CONTEXT_PACK_RISK_CONTRACT_VERSION } from '../../../src/contracts/context-pack-risk-contract.js';
import { validateCompositeContextPack } from '../../../src/contracts/validators/analysis.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import {
  loadChunkMeta,
  loadJsonArrayArtifactSync,
  MAX_JSON_BYTES,
  readCompatibilityKey
} from '../../../src/shared/artifact-io.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const { fixtureRoot, codeDir } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'retrieval-context-pack-risk',
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
assert.ok(seedSummary?.chunkUid, 'expected risk summary chunkUid in fixture index');

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

assert.equal(pack.risk?.status, 'ok', 'expected risk slice to assemble successfully');
assert.equal(pack.risk?.contractVersion, CONTEXT_PACK_RISK_CONTRACT_VERSION, 'expected explicit risk contract version');
assert.ok(Array.isArray(pack.risk?.flows) && pack.risk.flows.length > 0, 'expected interprocedural flows');
assert.ok(
  typeof pack.primary?.excerptHash === 'string' && pack.primary.excerptHash.length > 0,
  'expected primary excerpt hash'
);
assert.equal(
  pack.risk?.provenance?.indexSignature,
  pack.provenance?.indexSignature,
  'expected nested risk provenance to retain top-level index signature'
);
assert.equal(
  pack.risk?.provenance?.indexCompatKey,
  pack.provenance?.indexCompatKey,
  'expected nested risk provenance to retain top-level index compatibility key'
);
assert.match(
  pack.risk?.provenance?.ruleBundle?.fingerprint || '',
  /^sha1:/,
  'expected rule bundle fingerprint in nested risk provenance'
);
assert.ok(
  pack.risk?.provenance?.artifactRefs?.stats?.entrypoint,
  'expected risk stats artifact ref in nested provenance'
);

const validation = validateCompositeContextPack(pack);
assert.equal(validation.ok, true, `expected pack to validate: ${validation.errors.join(', ')}`);

console.log('retrieval context-pack risk assembly test passed');
