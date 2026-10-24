import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadIndexArtifacts } from '../../../src/index/build/piece-assembly/load.js';
import { assembleIndexPieces } from '../../../src/index/build/piece-assembly.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('piece-strict-input-preservation');
const input = path.join(root, 'input'), output = path.join(root, 'output');
await fs.mkdir(input); await fs.mkdir(output);
const fileMeta = [{ id: 0, file: 'one.js', ext: '.js', externalDocs: ['https://example.test/reference'],
  last_author: 'Ada', last_modified: '2026-10-21T00:00:00.000Z', churn: 0, churn_added: 3, churn_deleted: 1, churn_commits: 2 }];
const arrays = { chunk_meta: [{ id: 0, chunkUid: 'one', file: 'one.js', ext: '.js', fileId: 0 }], file_meta: fileMeta,
  file_relations: [{ file: 'one.js', relations: { imports: [] } }], call_sites: [], risk_flows: [], risk_summaries: [], risk_partial_flows: [] };
const entries = [];
for (const [name, value] of Object.entries(arrays)) {
  await fs.writeFile(path.join(input, `${name}.json`), JSON.stringify(value));
  entries.push({ name, path: `${name}.json`, format: 'json' });
}
await fs.writeFile(path.join(input, 'index_state.json'), JSON.stringify({ mode: 'code' }));
await fs.writeFile(path.join(input, 'token_postings.json'), JSON.stringify({ totalDocs: 1, avgDocLen: 1,
  vocab: ['word'], postings: [[[0, 1]]], docLengths: [1] }));
entries.push({ name: 'index_state', path: 'index_state.json', format: 'json' },
  { name: 'token_postings', path: 'token_postings.json', format: 'json' });
const tokens = [{ body: ['word'], name: ['one'] }];
await fs.mkdir(path.join(input, 'field_tokens.parts'));
await fs.writeFile(path.join(input, 'field_tokens.parts/part-0000.jsonl'), JSON.stringify(tokens[0]) + '\n');
await fs.writeFile(path.join(input, 'field_tokens.meta.json'), JSON.stringify({ format: 'jsonl-sharded',
  parts: ['field_tokens.parts/part-0000.jsonl'], count: 1 }));
entries.push({ name: 'field_tokens', path: 'field_tokens.parts/part-0000.jsonl', format: 'jsonl' },
  { name: 'field_tokens_meta', path: 'field_tokens.meta.json', format: 'json' });
await writePiecesManifest(input, entries);
try {
  const loaded = await loadIndexArtifacts(input, { strict: true, expectedMode: 'code' });
  assert.deepEqual(loaded.fieldTokens, tokens, 'manifest-selected shards preserve all field-token rows');
  for (const field of ['externalDocs', 'last_author', 'last_modified', 'churn', 'churn_added', 'churn_deleted', 'churn_commits']) {
    assert.deepEqual(loaded.chunkMeta[0][field], fileMeta[0][field], `${field} survives chunks that already have file/ext`);
  }
  assert.equal(loaded.fileInfoByPath.get('one.js').last_author, 'Ada');
  assert.equal(loaded.denseVec, null, 'genuinely absent optional artifacts remain absent');
  await assert.rejects(loadIndexArtifacts(input, { expectedMode: 'prose' }), /mode mismatch/);
  await fs.writeFile(path.join(output, 'sentinel'), 'prior output');
  for (const name of ['file_meta', 'file_relations', 'call_sites', 'risk_flows', 'risk_summaries', 'risk_partial_flows']) {
    const file = path.join(input, `${name}.json`), prior = await fs.readFile(file);
    await fs.writeFile(file, '[truncated');
    let prepared = false;
    await assert.rejects(assembleIndexPieces({ inputs: [input], outDir: output, root,
      mode: 'code', strict: true, userConfig: { indexing: { scm: { provider: 'none' }, typeInference: false,
        typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false } }, log() {},
      prepareOutput: async () => { prepared = true; await fs.rm(output, { recursive: true }); } }));
    assert.equal(prepared, false, `${name}: corruption fails before destructive output preparation`);
    assert.equal(await fs.readFile(path.join(output, 'sentinel'), 'utf8'), 'prior output');
    await fs.writeFile(file, prior);
  }
  await fs.writeFile(path.join(input, 'dense_vectors_uint8.bin.meta.json'), '{invalid');
  await writePiecesManifest(input, [...entries, { name: 'dense_vectors_binary_meta', path: 'dense_vectors_uint8.bin.meta.json', format: 'json' }]);
  await assert.rejects(loadIndexArtifacts(input, { strict: true, expectedMode: 'code' }), /JSON|Unexpected|parse/i);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Strict assembly preserves metadata/sharded tokens and rejects wrong-mode or corrupt declared input before output mutation.');
