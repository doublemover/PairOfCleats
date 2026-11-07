import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { inventoryStageOutputForCopy } from '../../../src/index/build/stage-output.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createLoggerScope } from '../../../src/shared/progress-runtime.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('checksum-native-metadata-consumers');
const identity = await fsp.lstat(dir, { bigint: true });
const buildRoot = path.join(dir, 'build'), outDir = path.join(buildRoot, 'index-code');
await fsp.mkdir(outDir, { recursive: true });
const source = path.join(outDir, 'rows.jsonl'), unstable = path.join(outDir, 'unstable.jsonl');
const bytes = Buffer.from('{"id":0}\n{"id":1}\n');
await fsp.writeFile(source, bytes); await fsp.writeFile(unstable, bytes);
const originals = { open: fsp.open, fstat: fs.fstatSync }, sources = new Set([source, unstable]), fds = new Set(), live = new Set();
const counts = { opens: 0, closes: 0, nativeStats: 0, asyncStats: 0, mutations: 0 };
let mutate = false;
fsp.open = async function(filename, ...args) {
  const handle = await Reflect.apply(originals.open, this, [filename, ...args]);
  if (!sources.has(filename)) return handle;
  counts.opens++; live.add(handle); fds.add(handle.fd);
  const read = handle.read, close = handle.close;
  handle.stat = async () => { counts.asyncStats++; throw new Error('hash caller dispatched avoidable asynchronous metadata'); };
  handle.read = async function(...input) {
    if (filename === unstable && mutate) { mutate = false; counts.mutations++; await fsp.appendFile(filename, '!'); }
    return Reflect.apply(read, this, input);
  };
  handle.close = async function(...input) {
    const fd = handle.fd, result = await Reflect.apply(close, this, input);
    assert.ok(live.delete(handle)); fds.delete(fd); counts.closes++; return result;
  };
  return handle;
};
fs.fstatSync = function(fd, ...args) { if (fds.has(fd)) counts.nativeStats++; return Reflect.apply(originals.fstat, this, [fd, ...args]); };
const indexState = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', stage: 'stage2', buildId: 'native-hash-consumers' };
const write = filename => writePiecesManifest({ outDir, mode: 'code', indexState,
  pieceEntries: [{ name: 'fixture_rows', path: path.basename(filename), format: 'jsonl', count: 2, bytes: bytes.length }] });
const logger = createLoggerScope(); let messages = 0;
logger.setProgressHandlers({ log(message) { assert.equal(message, '→ Wrote pieces manifest (1 entries).'); messages++; } });
const changed = (error, seen = new Set()) => {
  if (error?.code === 'ERR_FILE_CHANGED') return true;
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  return changed(error.cause, seen) || Array.isArray(error.errors) && error.errors.some(value => changed(value, seen));
};
let primary, failed = false;
try {
  await logger.run(() => write(source));
  assert.equal(messages, 1); assert.equal(counts.opens, 1); assert.equal(counts.closes, 1); assert.equal(counts.asyncStats, 0);
  assert.ok(counts.nativeStats >= 4, 'admission and before/after/verification retain fresh original-fd observations');
  const manifestPath = path.join(outDir, 'pieces/manifest.json'), manifest = JSON.parse(await fsp.readFile(manifestPath));
  // A non-SHA256 published checksum must still perform the actual contained
  // fallback hash for the unpublished-copy inventory, rather than reuse bytes.
  manifest.pieces[0].checksum = 'xxh64:0000000000000000'; await fsp.writeFile(manifestPath, JSON.stringify(manifest));
  const before = { ...counts };
  const inventory = await inventoryStageOutputForCopy({ buildRoot, buildId: indexState.buildId, mode: 'code' });
  assert.deepEqual(inventory.inventory, [{ path: 'rows.jsonl', bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') }]);
  assert.equal(counts.opens - before.opens, 1); assert.equal(counts.closes - before.closes, 1);
  assert.ok(counts.nativeStats - before.nativeStats >= 4); assert.equal(counts.asyncStats, 0);
  // The optimization must observe real growth on the held original descriptor.
  mutate = true; await assert.rejects(logger.run(() => write(unstable)), changed);
  assert.equal(counts.mutations, 1); assert.equal(counts.asyncStats, 0);
  assert.equal(live.size, 0); assert.equal(counts.opens, counts.closes);
  assert.deepEqual(await fsp.readFile(source), bytes);
  console.log(JSON.stringify({ counts, authority: 'fresh same-descriptor native metadata;original checksums and growth rejection' }));
} catch (error) { primary = error; failed = true; }
finally {
  fsp.open = originals.open; fs.fstatSync = originals.fstat;
  for (const [phase, work] of [['checksum-logger-close', () => logger.close()], ['checksum-fixture-cleanup', async () => {
    assert.equal(live.size, 0);
    const current = await fsp.lstat(dir, { bigint: true });
    assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino);
    assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep)); await fsp.rm(dir, { recursive: true, force: false });
  }]]) {
    try { await work(); } catch (cleanup) { primary = failed ? addStorageFailureContext(primary, { phase }, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
  }
}
if (failed) throw primary;
