import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assembleIndexPieces } from '../../../src/index/build/piece-assembly.js';
import { loadChunkMeta, loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const { dir } = await prepareIsolatedTestCacheDir('piece-persisted-metadata-and-field-tokens');
applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off' });
const userConfig = { indexing: { scm: { provider: 'none' }, typeInference: false,
  typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
  embeddings: { enabled: false, mode: 'off' } }, sqlite: { use: false } };
const files = ['zeta.js', 'alpha.js', 'beta.js'];
const metadata = files.map((file, id) => ({ id, file, ext: '.js', externalDocs: [`https://example.test/${id}`],
  last_author: `author-${id}`, last_modified: '2026-10-29T00:00:00Z',
  churn: id === 0 ? 0 : 7, churn_added: id, churn_deleted: 0, churn_commits: 2 }));
const tokens = files.map(file => ({ body: [file, 'body'], name: [file.slice(0, -3)] }));
const writeInput = async (input, form, missing = false) => {
  await fs.mkdir(input, { recursive: true });
  const rows = missing ? [{ id: 0, file: 'middle.js', ext: '.js' }] : metadata.map(({ file, ext, id }) => ({ id, file, ext, fileId: id,
    ...(id === 1 ? { last_author: 'explicit chunk author', churn: 0 } : {}) }));
  for (const row of rows) Object.assign(row, { start: 0, end: 1, tokens: ['word'],
    chunkUid: `ck64:v1:assembly:${row.file}:0000000000000001`, virtualPath: row.file });
  const pieces = [];
  for (const [name, value] of Object.entries({ chunk_meta: rows, file_meta: missing ? [{ id: 0, file: 'middle.js', ext: '.js' }] : metadata,
    index_state: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'persisted-assembly-fixture', mode: 'code', stage: 'stage2' },
    token_postings: { totalDocs: rows.length, avgDocLen: 1, vocab: ['word'], postings: [rows.map((_, id) => [id, 1])], docLengths: rows.map(() => 1) } })) {
    await fs.writeFile(path.join(input, `${name}.json`), JSON.stringify(value));
    pieces.push({ name, path: `${name}.json`, format: 'json' });
  }
  if (!missing && form === 'sharded') {
    await fs.mkdir(path.join(input, 'field_tokens.parts'));
    const parts = [tokens.slice(0, 2), tokens.slice(2)].map((rows, id) => ({ rows,
      path: `field_tokens.parts/field_tokens.part-${String(id).padStart(5, '0')}.jsonl` }));
    for (const part of parts) {
      await fs.writeFile(path.join(input, part.path), part.rows.map(row => JSON.stringify(row) + '\n').join(''));
      pieces.push({ name: 'field_tokens', path: part.path, format: 'jsonl', count: part.rows.length });
    }
    await fs.writeFile(path.join(input, 'field_tokens.meta.json'), JSON.stringify({ format: 'jsonl-sharded',
      count: tokens.length, totalRecords: tokens.length, parts: parts.map(part => part.path) }));
    pieces.push({ name: 'field_tokens_meta', path: 'field_tokens.meta.json', format: 'json' });
  } else if (!missing) {
    await fs.writeFile(path.join(input, 'field_tokens.json'), JSON.stringify(tokens));
    pieces.push({ name: 'field_tokens', path: 'field_tokens.json', format: 'json', count: tokens.length });
  }
  await writePiecesManifest(input, pieces);
};
try {
  let reference;
  for (const form of ['json', 'sharded']) {
    const root = path.join(dir, form), absent = path.join(root, '00-absent'), present = path.join(root, '10-present'), outDir = path.join(root, 'output');
    await writeInput(absent, form, true); await writeInput(present, form); await fs.mkdir(outDir);
    await assembleIndexPieces({ inputs: [present, absent], outDir, root: dir, mode: 'code', userConfig, log() {} });
    const chunks = await loadChunkMeta(outDir, { strict: true });
    const persistedTokens = await loadJsonArrayArtifact(outDir, 'field_tokens', { strict: true });
    const fileMeta = await loadJsonArrayArtifact(outDir, 'file_meta', { strict: true });
    assert.deepEqual(chunks.map(row => row.file), ['alpha.js', 'beta.js', 'middle.js', 'zeta.js']);
    assert.deepEqual(persistedTokens, chunks.map(row => tokens[files.indexOf(row.file)] ?? null), 'output token ordinals follow remapped chunks across parts and absent input');
    for (const original of metadata) {
      const row = fileMeta.find(value => value.file === original.file); assert.ok(row);
      for (const field of ['externalDocs', 'last_author', 'last_modified', 'churn', 'churn_added', 'churn_deleted', 'churn_commits']) {
        const expected = original.id === 1 && field === 'last_author' ? 'explicit chunk author'
          : original.id === 1 && field === 'churn' ? 0 : original[field];
        assert.deepEqual(row[field], expected, `${form}/${original.file}/${field} persists after successful assembly`);
      }
    }
    reference ??= persistedTokens; assert.deepEqual(persistedTokens, reference);
    if (form === 'sharded') {
      const lastPart = path.join(present, 'field_tokens.parts/field_tokens.part-00001.jsonl'), bytes = await fs.readFile(lastPart);
      const sentinel = path.join(outDir, 'prior-output'); await fs.writeFile(sentinel, 'retained');
      for (const fault of ['missing', 'corrupt']) {
        if (fault === 'missing') await fs.unlink(lastPart); else await fs.writeFile(lastPart, '{broken\n');
        let prepared = false;
        await assert.rejects(assembleIndexPieces({ inputs: [present, absent], outDir, root: dir, mode: 'code', userConfig,
          log() {}, prepareOutput: async () => { prepared = true; await fs.rm(outDir, { recursive: true, force: true }); } }));
        assert.equal(prepared, false); assert.equal(await fs.readFile(sentinel, 'utf8'), 'retained');
        await fs.writeFile(lastPart, bytes);
      }
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Successful persisted assembly retains complete file metadata and exact remapped field-token rows for JSON/sharded/absent inputs.');
