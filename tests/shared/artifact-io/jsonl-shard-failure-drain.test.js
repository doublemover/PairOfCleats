import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json/read-jsonl-array.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('jsonl-shard-failure-drain');
const createReadStream = fs.createReadStream;
const paths = ['a', 'b', 'c', 'd'].map((name, index) => path.join(dir, `sample.part-${String(index).padStart(6, '0')}.jsonl.zst`));
const expected = paths.map((_, index) => ({ id: index }));
const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [...paths.map(file => ({ name: 'sample', path: path.basename(file), format: 'jsonl', count: 1 })),
    { name: 'sample_meta', path: 'sample.meta.json', format: 'json' }] };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const contains = (value, wanted, seen = new Set()) => {
  if (value === wanted) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return contains(value.cause, wanted, seen) || (value.errors || []).some(error => contains(error, wanted, seen));
};
try {
  await fsp.writeFile(path.join(dir, 'sample.meta.json'), JSON.stringify({ format: 'jsonl-sharded', parts: paths.map(file => path.basename(file)) }));
  await Promise.all(paths.map((file, index) => fsp.writeFile(file, zstdCompressSync(Buffer.from(JSON.stringify(expected[index]) + '\n')))));
  for (const route of ['direct', 'artifact']) {
    const sourceFailure = Object.freeze(Object.assign(new Error(`${route}: original source read failed`), { code: 'EIO' }));
    const closeFailure = route === 'artifact' ? Object.freeze(new Error('independent held source-close failure')) : null;
    const bOpened = deferred(), bCloseHeld = deferred();
    const started = [], streams = [], closed = [];
    let releaseClose = false, heldFinish = null, publicSettled = false, failure;
    const release = () => { releaseClose = true; heldFinish?.(); };
    fs.createReadStream = function (file, ...args) {
      const stream = createReadStream.call(this, file, ...args), selected = path.resolve(String(file));
      started.push(selected); streams.push(stream); closed.push(new Promise(resolve => stream.once('close', resolve)));
      if (selected === paths[0]) {
        let requested = false;
        stream._read = () => {
          if (requested) return; requested = true;
          void bOpened.promise.then(() => stream.destroy(sourceFailure));
        };
      } else if (selected === paths[1]) {
        if (Number.isInteger(stream.fd)) bOpened.resolve(); else stream.once('open', bOpened.resolve);
        stream._read = () => {};
        const destroy = stream._destroy;
        stream._destroy = function (error, callback) {
          return destroy.call(this, error, originalError => {
            let finished = false;
            heldFinish = () => { if (!finished) { finished = true; callback(closeFailure || originalError); } };
            bCloseHeld.resolve();
            if (releaseClose) heldFinish();
          });
        };
      }
      return stream;
    };
    const work = route === 'direct' ? readJsonLinesArray(paths, { concurrency: 2 })
      : loadJsonArrayArtifact(dir, 'sample', { manifest, strict: true, concurrency: 2 });
    const handled = work.then(() => { publicSettled = true; }, error => { publicSettled = true; failure = error; });
    try {
      await Promise.race([bCloseHeld.promise, handled.then(() => { throw new Error('materialization rejected before its active reader close drained'); })]);
      assert.equal(publicSettled, false, 'the outward operation still owns the held cleanup');
      assert.deepEqual(started, paths.slice(0, 2), 'unstarted shards remain unclaimed after the original failure');
      release(); await handled;
      assert.ok(contains(failure, sourceFailure), 'the original first failure survives the joined boundary');
      if (closeFailure) assert.ok(contains(failure, closeFailure), 'independent close failure is retained beside the primary');
      assert.ok(streams.every(stream => stream.closed));
      assert.deepEqual(started, paths.slice(0, 2), 'cleanup completion cannot reopen admission for later shards');
    } finally {
      release(); for (const stream of streams) if (!stream.destroyed) stream.destroy(new Error('fixture cleanup cancels its held reader'));
      await Promise.allSettled(closed); await handled; fs.createReadStream = createReadStream;
    }
  }
  assert.deepEqual(await readJsonLinesArray(paths, { concurrency: 2 }), expected, 'successful bounded concurrency retains input order');
  assert.deepEqual(await loadJsonArrayArtifact(dir, 'sample', { manifest, strict: true, concurrency: 2 }), expected);
  assert.deepEqual(await readJsonLinesArray(paths[0]), [expected[0]], 'single-source behavior remains');
  assert.deepEqual(await readJsonLinesArray([]), []);
} finally { fs.createReadStream = createReadStream; await fsp.rm(dir, { recursive: true, force: true }); }
console.log('JSONL fan-out stops new shard claims and retains active source/decoder cleanup before rejection');
