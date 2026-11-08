import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { runDeferredPhaseFixture, readPhaseCompilerWitness, PHASE_COMPILER_REVOKED_CONFIG } from '../../helpers/semantic-phase-fixture.js';

await runDeferredPhaseFixture('semantic-phase-drain-compiler-revocation', async ({ repoRoot, indexDir, manifest, request, runSemanticEnrichmentService }) => {
  const witness = await readPhaseCompilerWitness({ repoRoot, indexDir, generation: manifest.generation });
  const manifestFile = path.join(indexDir, 'semantic_manifest.json'), originalManifest = await fs.readFile(manifestFile);
  const positive = await runSemanticEnrichmentService({ request });
  assert.equal(positive.status, 'planned'); assert.equal(positive.action, 'plan');
  assert.deepEqual(positive.supportedExecutors, ['bind', 'localFlow', 'crossFileFlow']);
  assert.deepEqual(positive.tasks.map(row => row.kind).sort(), ['bind', 'crossFileFlow', 'localFlow']);
  assert.ok(positive.tasks.every(row => row.executable));
  assert.deepEqual(witness.inventory.manifest.generation, request.generation);
  await fs.writeFile(path.join(repoRoot, 'tsconfig.json'), PHASE_COMPILER_REVOKED_CONFIG);
  await assert.rejects(runSemanticEnrichmentService({ request }), { code: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' });
  assert.equal(getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot)), indexDir);
  assert.deepEqual(await fs.readFile(manifestFile), originalManifest, 'rejected authority cannot modify the original published generation');
  console.log(JSON.stringify({ phase: 'compiler-authority-revocation', authorityHash: witness.authorityHash,
    verifierInputHash: witness.verifierInputHash, programSources: witness.programSourceCount, positivePublicAuthority: true, revokedCode: 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' }));
  console.log('same deferred compiler authority accepts healthy inputs and rejects changed strict compiler configuration');
});
