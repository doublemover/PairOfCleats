import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { addIssue, mergeValidationFindings, finalizeValidationReport, validationErrorMetadata } from '../../../src/index/validate/issues.js';

const { dir } = await prepareIsolatedTestCacheDir('validation-mode-findings');
const writeJson = (name, value) => fs.writeFile(name, JSON.stringify(value));
const mutateManifest = async (indexDir, update) => {
  const filename = path.join(indexDir, 'pieces', 'manifest.json');
  const value = JSON.parse(await fs.readFile(filename, 'utf8')); update(value); await writeJson(filename, value);
};
const capsule = async name => {
  const fixture = await createBaseIndex({ rootDir: path.join(dir, name) });
  const prose = path.join(fixture.indexRoot, 'index-prose');
  await fs.cp(fixture.indexDir, prose, { recursive: true });
  const statePath = path.join(prose, 'index_state.json');
  await writeJson(statePath, { ...JSON.parse(await fs.readFile(statePath, 'utf8')), mode: 'prose' });
  await writeJson(path.join(fixture.repoRoot, '.pairofcleats.json'), defaultUserConfig);
  return { ...fixture, prose };
};
const validate = fixture => validateIndexArtifacts({ root: fixture.repoRoot, indexRoot: fixture.indexRoot,
  modes: ['code', 'prose'], strict: true, userConfig: defaultUserConfig, sqliteEnabled: false, lmdbEnabled: false });
const assertOwned = (report, bad, wantedCode = null) => {
  const healthy = bad === 'code' ? 'prose' : 'code';
  assert.equal(report.ok, false); assert.equal(report.modes[bad].ok, false);
  assert.equal(report.modes[healthy].ok, true, 'an unrelated healthy mode retains its verdict');
  assert.ok(report.findings.some(row => row.mode === bad && row.severity === 'error' && (!wantedCode || row.code === wantedCode)));
  assert.equal(report.issues.length, report.findings.filter(row => row.severity === 'error').length);
  assert.deepEqual(report.issues, report.findings.filter(row => row.severity === 'error').map(row => row.display));
};
try {
  for (const bad of ['code', 'prose']) {
    for (const failure of ['collision', 'posting', 'schema', 'embedding', 'checksum', 'missing', 'read']) {
      const fixture = await capsule(`${bad}-${failure}`), indexDir = bad === 'code' ? fixture.indexDir : fixture.prose;
      let wantedCode = null, restore = () => {};
      if (failure === 'collision') {
        await writeJson(path.join(indexDir, 'repo_map.json'), [{ file: 'src/a.js', name: 'same', kind: 'Function' },
          { file: 'src/a.js', name: 'same', kind: 'Function' }]);
        await mutateManifest(indexDir, manifest => { manifest.pieces.push({ name: 'repo_map', type: 'chunks', format: 'json', path: 'repo_map.json' }); });
        wantedCode = 'ERR_ID_COLLISION';
      } else if (failure === 'posting') {
        const filename = path.join(indexDir, 'token_postings.json'), value = JSON.parse(await fs.readFile(filename, 'utf8'));
        value.postings = [[[0.5, 1]]]; await writeJson(filename, value); wantedCode = 'ERR_INDEX_POSTING_ID';
      } else if (failure === 'schema') {
        const filename = path.join(indexDir, 'chunk_meta.json'), rows = JSON.parse(await fs.readFile(filename, 'utf8'));
        rows[0].metaV2 = { chunkId: 99, chunkUid: rows[0].chunkUid,
          file: rows[0].file, virtualPath: rows[0].virtualPath };
        await writeJson(filename, rows); wantedCode = 'ERR_INDEX_ARTIFACT_SCHEMA';
      } else if (failure === 'embedding') {
        const filename = path.join(indexDir, 'index_state.json'), state = JSON.parse(await fs.readFile(filename, 'utf8'));
        state.embeddings = { embeddingGeneration: 'a'.repeat(64) }; await writeJson(filename, state);
        await fs.writeFile(path.join(indexDir, 'dense_vectors_hnsw.bin'), 'fixture');
        await writeJson(path.join(indexDir, 'dense_vectors_hnsw.meta.json'), { dims: 2, model: 'fixture', count: 1,
          space: 'cosine', m: 16, efConstruction: 200, efSearch: 50, embeddingGeneration: 'b'.repeat(64) });
        await mutateManifest(indexDir, manifest => { manifest.pieces.push(
          { name: 'dense_vectors_hnsw', type: 'dense', format: 'bin', path: 'dense_vectors_hnsw.bin' },
          { name: 'dense_vectors_hnsw_meta', type: 'dense', format: 'json', path: 'dense_vectors_hnsw.meta.json' }); });
        wantedCode = 'ERR_INDEX_EMBEDDING_IDENTITY';
      } else if (failure === 'checksum') {
        await mutateManifest(indexDir, manifest => { manifest.pieces[0].checksum = 'sha1:' + '0'.repeat(40); });
        wantedCode = 'ERR_INDEX_PIECE_CHECKSUM';
      } else if (failure === 'missing') {
        await fs.rm(path.join(indexDir, 'chunk_meta.json')); wantedCode = 'ERR_INDEX_PIECE_MISSING';
      } else {
        const target = path.join(indexDir, 'token_postings.json'), stat = fsSync.statSync, read = fsSync.readFileSync;
        const fail = name => { if (typeof name === 'string' && path.resolve(name) === target) throw Object.assign(new Error('injected owned read failure'), { code: 'EIO' }); };
        fsSync.statSync = function(name, ...args) { fail(name); return stat.call(this, name, ...args); };
        fsSync.readFileSync = function(name, ...args) { fail(name); return read.call(this, name, ...args); };
        restore = () => { fsSync.statSync = stat; fsSync.readFileSync = read; };
      }
      let report;
      try { report = await validate(fixture); } finally { restore(); }
      assertOwned(report, bad, wantedCode);
      if (failure === 'read') assert.ok(report.modes[bad].unverified.length > 0, 'a failed observation cannot qualify content as verified');
      if (failure === 'collision' || failure === 'schema' || failure === 'embedding' || failure === 'checksum') {
        assert.equal(report.modes[bad].state, 'invalid');
        assert.equal(report.modes[bad].missing.some(message => message.includes('collision') || message.includes('checksum')), false);
      }
      if (failure === 'collision') {
        const cli = fileURLToPath(new URL('../../../tools/index/validate.js', import.meta.url));
        const args = [cli, '--repo', fixture.repoRoot, '--index-root', fixture.indexRoot, '--mode', 'code,prose'];
        const human = runNode(args, 'validation human verdict', process.cwd(), process.env,
          { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
        assert.equal(human.status, 1); assert.equal(human.error, undefined);
        assert.ok(human.stderr.includes(`- ${bad}: invalid`));
        assert.ok(human.stderr.includes(`- ${bad === 'code' ? 'prose' : 'code'}: ok`));
        const json = runNode([...args, '--json'], 'validation JSON verdict', process.cwd(), process.env,
          { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
        assert.equal(json.status, 1); assert.equal(json.error, undefined);
        assertOwned(JSON.parse(json.stdout), bad, 'ERR_ID_COLLISION');
      }
    }
  }
  const healthy = await validate(await capsule('optional-warnings'));
  assert.equal(healthy.ok, true); assert.ok(healthy.warnings.length > 0);
  assert.equal(healthy.modes.code.ok, true); assert.equal(healthy.modes.prose.ok, true);
  assert.ok(healthy.findings.every(row => row.severity === 'warning'));
  const report = { issues: [], warnings: [], hints: [], modes: { code: {}, prose: {} }, sqlite: {}, lmdb: {} };
  addIssue(report, 'code', 'initial warning', null, 'warnings');
  const anchor = report.findings.length;
  addIssue(report, 'prose', 'late schema error', null, 'issues', { artifact: 'chunk_meta', code: 'ERR_INDEX_ARTIFACT_SCHEMA' });
  const deferred = { issues: [], warnings: [], hints: [] };
  addIssue(deferred, 'code', 'deferred checksum error', null, 'issues', { code: 'ERR_INDEX_PIECE_CHECKSUM' });
  mergeValidationFindings(report, deferred, anchor);
  assert.deepEqual(report.issues, ['[code] deferred checksum error', '[prose] late schema error']);
  addIssue(report, null, 'backend unavailable', null, 'issues', { capability: 'sqlite', state: 'unverified' });
  finalizeValidationReport(report);
  assert.equal(report.sqlite.ok, false); assert.equal(report.lmdb.ok, true);
  assert.equal(validationErrorMetadata({ code: 'EIO' }, 'chunk_meta').state, 'unverified');
  assert.equal(validationErrorMetadata({ code: 'ENOENT' }, 'chunk_meta').state, 'missing');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Aggregate, mode and human/JSON verdicts derive from the same typed semantic/manifest/backend findings.');
