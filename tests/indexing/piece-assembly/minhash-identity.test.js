import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MINHASH_HASH_IDENTITY, SimpleMinHash, minifyMinhashSignature, resolveMinhashSampledPlan } from '../../../src/index/minhash.js';
import { assembleIndexPieces } from '../../../src/index/build/piece-assembly.js';
import { packMinhashSignatures } from '../../../src/index/build/artifacts/minhash-packed.js';
import { loadMinhashSignatures } from '../../../src/shared/artifact-io/loaders/minhash.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { computePackedChecksum } from '../../../src/shared/artifact-io/checksum.js';
import { rankMinhash } from '../../../src/retrieval/rankers.js';
import { validateSupplementalPostingsArtifacts } from '../../../src/index/validate/postings.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('piece-minhash-identity');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const hash = new SimpleMinHash();
for (const token of ['alpha', 'beta']) hash.update(token);
const full = [...hash.hashValues];
const sampling = resolveMinhashSampledPlan({ totalDocs: 100, maxDocs: 20, signatureLength: full.length });
const createInput = async (name, plan = null, hashIdentity = MINHASH_HASH_IDENTITY) => {
  const input = path.join(dir, name);
  await fs.mkdir(input);
  const chunkUid = `ck64:v1:piece:${name}:0000000000000001`;
  await fs.writeFile(path.join(input, 'chunk_meta.json'), JSON.stringify([
    { id: 0, file: `src/${name}.js`, ext: '.js', start: 0, end: 1, chunkUid,
      tokens: ['alpha', 'beta'], metaV2: { schemaVersion: 3, chunkUid, virtualPath: `src/${name}.js` } }
  ]));
  await writeJsonObjectFile(path.join(input, 'index_state.json'), {
    fields: { buildId: 'minhash-piece-fixture', mode: 'code',
      generatedAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z', counts: { files: 1, chunks: 1 } }
  });
  await writeJsonObjectFile(path.join(input, 'token_postings.json'), {
    fields: { totalDocs: 1, avgDocLen: 2 }, arrays: { vocab: ['alpha', 'beta'], postings: [[[0, 1]], [[0, 1]]], docLengths: [2] }
  });
  const packed = packMinhashSignatures({ signatures: [plan ? minifyMinhashSignature(full, plan) : full] });
  await fs.writeFile(path.join(input, 'minhash_signatures.packed.bin'), packed.buffer);
  await writeJsonObjectFile(path.join(input, 'minhash_signatures.packed.meta.json'), {
    fields: { format: 'u32', endian: 'le', dims: packed.dims, count: 1, hashIdentity,
      checksum: computePackedChecksum(packed.buffer).hash, ...(plan ? { sampling: plan } : {}) }
  });
  await writePiecesManifest(input, [
    { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json' },
    { name: 'index_state', path: 'index_state.json', format: 'json' },
    { name: 'token_postings', path: 'token_postings.json', format: 'json' },
    { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
    { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
  ]);
  return input;
};
const assemble = (inputs, name) => assembleIndexPieces({ inputs, outDir: path.join(dir, name), root: dir,
  mode: 'code', userConfig: { indexing: { scm: { provider: 'none' } } }, log: () => {} });
const validatePacked = async input => {
  const report = { issues: [], hints: [] };
  await validateSupplementalPostingsArtifacts({ report, mode: 'code', dir: input, strict: true,
    modeReport: { ok: true, missing: [] }, chunkMeta: [{}],
    shouldLoadOptional: name => name === 'minhash_signatures', readJsonArtifact: () => null });
  return report;
};
for (const [name, plan] of [['full', null], ['sampled', sampling]]) {
  const inputs = await Promise.all([createInput(`${name}-a`, plan), createInput(`${name}-b`, plan)]);
  assert.deepEqual((await validatePacked(inputs[0])).issues, [], 'packed-only validator must accept the current producer');
  await fs.mkdir(path.join(dir, `${name}-out`));
  await assemble(inputs, `${name}-out`);
  const loaded = await loadMinhashSignatures(path.join(dir, `${name}-out`));
  assert.equal(loaded.hashIdentity, MINHASH_HASH_IDENTITY);
  assert.deepEqual(loaded.signatures.map(row => Array.from(row)), Array(2).fill(plan ? minifyMinhashSignature(full, plan) : full),
    'packed row views retain their values through assembly and JSON/packed publication');
  assert.equal(loaded.sampling?.hashStride ?? null, plan?.hashStride ?? null);
  assert.equal(rankMinhash({ minhash: loaded }, ['alpha', 'beta'], 1, new Set([1]))[0]?.sim, 1);
}
for (const identity of [null, 'legacy-polynomial-v1']) {
  const input = await createInput(`bad-${identity ?? 'missing'}`, null, identity);
  assert.match((await validatePacked(input)).issues.join('\n'), /MinHash hash identity.*rebuild the index/);
  await assert.rejects(assemble([input], 'bad-out'), { code: 'ERR_ARTIFACT_INVALID' });
}
await assert.rejects(assemble([path.join(dir, 'full-a'), path.join(dir, 'sampled-a')], 'mixed-out'), /different minhash coordinate plans/);
assert.equal(await fs.stat(path.join(dir, 'mixed-out')).then(() => true, error => error.code !== 'ENOENT'), false,
  'mixed coordinate plans fail before publication');
console.log('MinHash piece assembly passed: real packed input, full/sampled publication, filters and incompatible-family/coordinate rejection');
