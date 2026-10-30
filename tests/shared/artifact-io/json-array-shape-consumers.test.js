import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { loadChunkMetaRows } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { admitJsonArrayPayload } from '../../../src/shared/artifact-io/payload-admission.js';
import { buildChunkUidMapSeedIndex } from '../../../src/context-pack/seed-resolution.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('json-array-shape-consumers');
const collect = async rows => { const out = []; for await (const row of rows) out.push(row); return out; };
const manifestFor = (name, filename, bytes) => ({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [{ name, path: filename, format: 'json', bytes: bytes.length,
    checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }] });
const invalid = error => error?.code === 'ERR_ARTIFACT_INVALID' && typeof error.sourcePath === 'string';
try {
  for (const compressed of [false, true]) for (const backup of [false, true]) {
    const target = path.join(dir, `${compressed}-${backup}`); await fs.mkdir(target);
    const filename = compressed ? 'rows.json.gz' : 'rows.json';
    for (const payload of [{}, null, 'text', 7, true, [], [{ id: 1 }, { id: 0 }]]) {
      const bytes = Buffer.from(JSON.stringify(payload));
      await fs.writeFile(path.join(target, filename + (backup ? '.bak' : '')), compressed ? gzipSync(bytes) : bytes);
      const manifest = manifestFor('sample', filename, compressed ? gzipSync(bytes) : bytes);
      for (const strict of [true, false]) {
        const materialized = () => loadJsonArrayArtifact(target, 'sample', { manifest, strict });
        const streamed = () => collect(loadJsonArrayArtifactRows(target, 'sample', { manifest, strict }));
        if (Array.isArray(payload)) {
          assert.deepEqual(await materialized(), payload); assert.deepEqual(await streamed(), payload);
        } else {
          await assert.rejects(materialized, invalid); await assert.rejects(streamed, invalid);
        }
      }
    }
  }
  const array = Array.from({ length: 4096 }, (_, id) => ({ id }));
  assert.equal(admitJsonArrayPayload(array), array, 'shape admission retains the original array without a second copy');
  const seedPath = path.join(dir, 'seeds.json');
  for (const payload of [{}, [], [{ docId: 0, chunkUid: 'source-uid', file: 'src/a.js' }]]) {
    const bytes = Buffer.from(JSON.stringify(payload)); await fs.writeFile(seedPath, bytes);
    const manifest = manifestFor('chunk_uid_map', 'seeds.json', bytes);
    const build = () => buildChunkUidMapSeedIndex({ indexDir: dir, repoRoot: dir, manifest });
    if (!Array.isArray(payload)) await assert.rejects(build, invalid);
    else { const result = await build(); assert.equal(result.readState, 'ready'); assert.equal(result.rowsIndexed, payload.length); }
  }
  for (const hotRows of [[], [{ id: 0, file: 'src/a.js', start: 0, end: 1 }]]) {
    await fs.writeFile(path.join(dir, 'hot.json'), JSON.stringify(hotRows));
    for (const cold of [{}, [], [{ id: 0, preContext: 'retained cold content' }]]) {
      await fs.writeFile(path.join(dir, 'cold.json'), JSON.stringify(cold));
      const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [
        { name: 'chunk_meta', path: 'hot.json', format: 'json' },
        { name: 'chunk_meta_cold', path: 'cold.json', format: 'json' }
      ] };
      const load = () => collect(loadChunkMetaRows(dir, { manifest, preferBinaryColumnar: false }));
      if (!Array.isArray(cold)) await assert.rejects(load, invalid);
      else {
        const result = await load(); assert.equal(result.length, hotRows.length);
        if (cold.length && hotRows.length) assert.equal(result[0].preContext, cold[0].preContext);
      }
      const guarded = structuredClone(manifest);
      guarded.pieces[0].extensions = { representationPlan: { schemaVersion: 1, family: 'chunk-meta',
        primary: 'json', emitBinaryColumnar: false, hotColdSplit: true, compatibility: [] } };
      if (!Array.isArray(cold) || (hotRows.length && !cold.length)) {
        await assert.rejects(collect(loadChunkMetaRows(dir, { manifest: guarded })), { code: 'ERR_ARTIFACT_INVALID' });
      } else assert.equal((await collect(loadChunkMetaRows(dir, { manifest: guarded }))).length, hotRows.length);
    }
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('JSON array shape is shared by materialized, streaming, seed and optional/required cold consumers.');
