#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { learnedAutoProfileInternals } from '../../../src/index/build/runtime/learned-auto-profile.js';
import { loadSchedulerAutoTuneProfile, writeSchedulerAutoTuneProfile } from '../../../src/index/build/runtime/scheduler-autotune-profile.js';
import { loadTreeSitterSchedulerAdaptiveProfile, saveTreeSitterSchedulerAdaptiveProfile } from '../../../src/index/build/tree-sitter-scheduler/adaptive-profile.js';
import { loadEmbeddingsAutoTuneRecommendation, writeEmbeddingsAutoTuneRecommendation } from '../../../tools/build/embeddings/autotune-profile.js';
import { persistPyrightPlannerHealth, resolvePyrightRequestPlan } from '../../../src/index/tooling/pyright-planner.js';
import { persistPyrightRuntimeHealth, resolvePyrightRuntimeHealth, buildPyrightRuntimeFingerprint } from '../../../src/index/tooling/pyright-runtime-health.js';
import { updateEnrichmentState } from '../../../src/integrations/core/enrichment-state.js';
import { classifyGeneratedArtifactCachePrefix, withoutGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';

const root = resolveTestCachePath(process.cwd(), 'runtime-cache-metadata-roundtrip');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const verifyLegacyParity = async (file, artifact, read) => {
  const prefix = await fs.readFile(file, 'utf8');
  const payload = JSON.parse(prefix);
  assert.equal(Object.keys(payload)[0], '__poc_generated');
  assert.equal(classifyGeneratedArtifactCachePrefix({ prefix })?.artifact, artifact);
  const marked = await read();
  await fs.writeFile(file, JSON.stringify(withoutGeneratedCacheMetadata(payload)));
  assert.deepEqual(await read(), marked, `${artifact} legacy read parity`);
  return marked;
};

try {
  const learnedPath = learnedAutoProfileInternals.resolveStatePath(root);
  assert.equal(await learnedAutoProfileInternals.saveAutoProfileState({
    statePath: learnedPath, state: { profiles: { fixture: { profileId: 'balanced', confidence: 0.8, features: { files: 12 } } } }
  }), true);
  const learned = await verifyLegacyParity(learnedPath, 'learned-auto-profile', () => learnedAutoProfileInternals.loadAutoProfileState(root));
  assert.deepEqual(Object.keys(learned.state.profiles), ['fixture']);

  const schedulerWritten = await writeSchedulerAutoTuneProfile({ repoCacheRoot: root, schedulerStats: { tokens: { cpu: { total: 2 } } }, schedulerConfig: {}, buildId: 'fixture' });
  assert.equal(schedulerWritten.__poc_generated, undefined);
  await verifyLegacyParity(path.join(root, 'metrics/scheduler-autotune.json'), 'scheduler-autotune', () => loadSchedulerAutoTuneProfile({ repoCacheRoot: root }));

  const adaptivePath = path.join(root, 'tree-sitter-scheduler/adaptive-rows-per-sec.json');
  await saveTreeSitterSchedulerAdaptiveProfile({ profilePath: adaptivePath, entriesByGrammarKey: new Map([['javascript', { rowsPerSec: 25, samples: 3 }]]) });
  const adaptive = await verifyLegacyParity(adaptivePath, 'tree-sitter-adaptive-profile', () => loadTreeSitterSchedulerAdaptiveProfile({ runtime: { repoCacheRoot: root } }));
  assert.equal(adaptive.entriesByGrammarKey.get('javascript').rowsPerSec, 25);
  assert.equal(adaptive.entriesByGrammarKey.size, 1);

  const embeddingsArgs = { repoCacheRoot: root, provider: 'fixture', modelId: 'fixture', recommended: { batchSize: 8 }, now: '2026-10-06T00:00:00Z' };
  await writeEmbeddingsAutoTuneRecommendation(embeddingsArgs);
  await verifyLegacyParity(path.join(root, 'metrics/embeddings-autotune.json'), 'embeddings-autotune', () => loadEmbeddingsAutoTuneRecommendation(embeddingsArgs));

  const plannerArgs = { repoRoot: root, cacheRoot: root, workspaceRootRel: '.' };
  const plannerPath = await persistPyrightPlannerHealth({ ...plannerArgs, runtime: { requests: { byMethod: { 'textDocument/hover': { timedOut: 3 } } } } });
  await verifyLegacyParity(plannerPath, 'pyright-planner-health', () => resolvePyrightRequestPlan({ ...plannerArgs, documents: [], targets: [] }));

  const now = Date.parse('2026-10-06T00:00:00Z');
  const runtimeArgs = { ...plannerArgs, selectedDocumentSummaries: [], now };
  const fingerprint = buildPyrightRuntimeFingerprint(runtimeArgs);
  const healthPath = await persistPyrightRuntimeHealth({ ...plannerArgs, record: {
    schemaVersion: 1, state: 'degraded_hard', fingerprint, cooldownUntil: now + 60000, reasonCode: 'fixture', timeoutStormCount: 2
  } });
  const health = await verifyLegacyParity(healthPath, 'pyright-runtime-health', () => resolvePyrightRuntimeHealth(runtimeArgs));
  assert.equal(health.shouldShortCircuit, true);
  assert.equal(health.cooldownRemainingMs, 60000);

  const first = await updateEnrichmentState(root, { pending: { source: 'src/app.js' }, extensions: { custom: true } });
  assert.equal(first.__poc_generated, undefined);
  const stateFile = path.join(root, 'enrichment_state.json');
  const markedState = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(markedState.__poc_generated.artifact, 'enrichment-state');
  const second = await updateEnrichmentState(root, { completed: true });
  assert.equal(second.__poc_generated, undefined);
  assert.deepEqual(second.pending, first.pending);
  assert.deepEqual(second.extensions, { custom: true });
  await fs.writeFile(stateFile, JSON.stringify(withoutGeneratedCacheMetadata(markedState)));
  const legacyUpdate = await updateEnrichmentState(root, { completed: true });
  assert.deepEqual({ ...legacyUpdate, updatedAt: null }, { ...second, updatedAt: null });
  assert.equal(JSON.parse(await fs.readFile(stateFile, 'utf8')).__poc_generated.artifact, 'enrichment-state');
  console.log('runtime-cache metadata preserves legacy profile, health and state behavior');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
