import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { assembleIndexPieces } from '../../../src/index/build/piece-assembly.js';
import { buildCompatibilityKey, buildCohortKey } from '../../../src/contracts/compatibility.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';

const { dir } = await prepareIsolatedTestCacheDir('assembly-mode-cohort-cli');
const env = applyTestEnv({ syncProcess: false });
const runtime = {}, tokenizationKeys = { code: 'code-tokens', prose: 'prose-tokens' };
const compatibilityKey = buildCompatibilityKey({ runtime, modes: ['code', 'prose'], tokenizationKeys });
const inputs = {};
for (const mode of ['code', 'prose']) {
  const input = path.join(dir, mode); inputs[mode] = input; await fs.mkdir(input);
  const artifacts = { index_state: { mode, buildId: 'mode-cohort-fixture', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    cohortKey: buildCohortKey({ runtime, mode, tokenizationKeys }) },
  chunk_meta: [{ id: 0, file: `${mode}.txt`, chunkUid: mode, start: 0, end: 1 }],
  token_postings: { vocab: ['word'], postings: [[[0, 1]]], docLengths: [1], totalDocs: 1, avgDocLen: 1 } };
  await assignChunkUids({ chunks: artifacts.chunk_meta, fileText: 'w', fileRelPath: mode + '.txt', namespaceKey: 'assembly-fixture' });
  for (const [name, value] of Object.entries(artifacts)) await fs.writeFile(path.join(input, `${name}.json`), JSON.stringify(value));
  await writePiecesManifest(input, Object.keys(artifacts).map(name => ({ name, path: `${name}.json`, format: 'json' })), { compatibilityKey });
}
const out = path.join(dir, 'out'); await fs.mkdir(out); await fs.writeFile(path.join(out, 'sentinel'), 'retain prior output');
for (const selected of [[inputs.prose], [inputs.code, inputs.prose]]) {
  const result = runNode(['tools/index/assemble-pieces.js', '--repo', dir, '--mode', 'code', '--out', out,
    '--force', ...selected.flatMap(input => ['--input', input])], 'wrong-mode assembly CLI', process.cwd(), env,
  { allowFailure: true, stdio: 'pipe', timeoutMs: 5000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /mode mismatch.*prose/i);
  assert.equal(await fs.readFile(path.join(out, 'sentinel'), 'utf8'), 'retain prior output');
}
await fs.writeFile(path.join(inputs.prose, 'index_state.json'), JSON.stringify({ mode: 'code', cohortKey: 'another-cohort' }));
const mismatch = runNode(['tools/index/assemble-pieces.js', '--repo', dir, '--mode', 'code', '--out', out,
  '--force', '--input', inputs.code, '--input', inputs.prose], 'mixed-cohort assembly CLI', process.cwd(), env,
{ allowFailure: true, stdio: 'pipe', timeoutMs: 5000 });
assert.equal(mismatch.status, 1); assert.match(mismatch.stderr, /cohortKey mismatch/);
assert.equal(await fs.readFile(path.join(out, 'sentinel'), 'utf8'), 'retain prior output');
let prepared = false;
await assembleIndexPieces({ inputs: [inputs.code], outDir: path.join(dir, 'valid'), root: dir, mode: 'code',
  userConfig: { indexing: { scm: { provider: 'none' }, typeInference: false, typeInferenceCrossFile: false,
    riskAnalysis: false, riskAnalysisCrossFile: false } }, log() {}, prepareOutput: async () => {
    prepared = true; await fs.mkdir(path.join(dir, 'valid'));
  } });
assert.equal(prepared, true, 'same-mode/same-cohort input reaches actual writer admission');
assert.equal(await fs.readFile(path.join(out, 'sentinel'), 'utf8'), 'retain prior output');
console.log('Actual assembly CLI rejects equal-compatibility wrong modes and mixed cohorts before forced writes.');
