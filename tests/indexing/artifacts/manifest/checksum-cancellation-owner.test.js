import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writePiecesManifest } from '../../../../src/index/build/artifacts/checksums.js';
import { captureInitialIndexStatePublication } from '../../../../src/index/build/artifacts/index-state-publication.js';
import { withIndexStatePublicationLock } from '../../../../src/shared/index-state-publication.js';
import { isFileLockPublicationPending } from '../../../../src/shared/locks/file-lock.js';
import { getContainedFileSession } from '../../../../src/shared/contained-file-resource.js';
import { errorGraphIncludes } from '../../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const borrowed = selected?.startsWith('borrowed-'), scenario = selected?.replace(/^(ordinary|borrowed)-/, '');
assert.ok(['read', 'close', 'close-failure', 'siblings', 'siblings-close-failure', 'preabort', 'sealed'].includes(scenario));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const { dir } = await prepareIsolatedTestCacheDir(`manifest-checksum-${selected}`);
const originalOpen = fs.open, release = gate(), started = gate(), busy = gate();
const controller = new AbortController(), cancellation = Object.freeze(Object.assign(new Error('original request cancelled'), { name: 'AbortError' }));
const lockPath = path.join(dir, '.index_state.write.lock'), manifestPath = path.join(dir, 'pieces/manifest.json');
const siblings = scenario.startsWith('siblings'), failedClose = scenario.endsWith('close-failure');
const descriptors = new Map(), entries = [], expectedReaders = siblings ? 4 : 1;
let readCalls = 0, closeCalls = 0, publicationSettled = false, allowClose = false, busyObservation = false;
const closeFailure = Object.freeze(new Error('original checksum close rejected before native closure'));
let outcome, work, contender;
const graph = failure => {
  const queue = [failure], seen = new Set(), values = [];
  while (queue.length) {
    const value = queue.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); values.push(value); queue.push(value.cause, value.workerError, ...(value.errors || []));
  }
  return values;
};
try {
  await fs.writeFile(path.join(dir, 'index_state.json'), JSON.stringify({ buildId: 'original', mode: 'code' }));
  const session = borrowed ? captureInitialIndexStatePublication(dir) : null;
  for (let id = 0; id < (siblings ? 5 : 1); id++) {
    const filename = `piece-${id}.json`, bytes = Buffer.from(JSON.stringify([{ id }]));
    await fs.writeFile(path.join(dir, filename), bytes);
    entries.push({ name: `sample-${id}`, path: filename, format: 'json', bytes: bytes.length });
  }
  if (scenario === 'sealed') {
    const value = await fs.readFile(path.join(dir, entries[0].path));
    entries[0].checksum = `sha256:${createHash('sha256').update(value).digest('hex')}`;
    entries.push({ name: 'index_state', path: 'index_state.json', format: 'json', checksum: entries[0].checksum });
  }
  fs.open = async (target, ...options) => {
    let handle;
    try { handle = await originalOpen(target, ...options); }
    catch (error) {
      if (path.resolve(target) === lockPath && error.code === 'EEXIST' && busyObservation) busy.resolve();
      throw error;
    }
    const filename = path.resolve(target);
    if (filename === lockPath || !entries.some(entry => path.join(dir, entry.path) === filename)) return handle;
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    const finished = gate(); descriptors.set(filename, { handle, close, closed: false, finished });
    handle.read = async (...args) => {
      readCalls++;
      if (scenario === 'read' || scenario === 'siblings') {
        if (readCalls === expectedReaders) started.resolve();
        await release.promise;
      }
      return read(...args);
    };
    handle.close = async () => {
      try {
        closeCalls++;
        if (scenario === 'close' || failedClose) {
          if (closeCalls === expectedReaders) started.resolve();
          await release.promise;
        }
        if (failedClose && !allowClose) throw closeFailure;
        await close(); descriptors.get(filename).closed = true;
      } finally { finished.resolve(); }
    };
    return handle;
  };
  if (scenario === 'preabort') controller.abort(cancellation);
  work = writePiecesManifest({ outDir: dir, mode: 'code', pieceEntries: entries,
    indexState: { buildId: 'original' }, abortSignal: controller.signal,
    ...(borrowed ? { indexStatePublication: session } : {}) });
  const observed = work.then(value => { publicationSettled = true; return { ok: true, value }; },
    error => { publicationSettled = true; return { ok: false, error }; });
  if (scenario === 'preabort') {
    outcome = await observed; assert.equal(outcome.ok, false); assert.ok(errorGraphIncludes(outcome.error, cancellation));
    assert.equal(descriptors.size, 0);
  } else if (scenario === 'sealed') {
    outcome = await observed; assert.equal(outcome.ok, true);
    assert.equal(descriptors.has(path.join(dir, entries[0].path)), false, 'sealed payload checksum avoids unnecessary readers');
    assert.equal(descriptors.has(path.join(dir, 'index_state.json')), true, 'index-state is always hashed through its original reader');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.pieces.map(piece => piece.path), entries.map(piece => piece.path).sort());
    assert.equal(manifest.pieces.find(piece => piece.path === entries[0].path).checksum, entries[0].checksum);
  } else {
    await started.promise; controller.abort(cancellation);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(publicationSettled, false, 'public cancellation must wait for original checksum readers/closers');
    await assert.rejects(fs.access(manifestPath), { code: 'ENOENT' });
    assert.equal((await fs.stat(lockPath)).isFile(), true);
    let entered = false;
    if (!failedClose) {
      contender = withIndexStatePublicationLock(dir, () => { entered = true; });
      await new Promise(resolve => setImmediate(resolve)); assert.equal(entered, false);
    }
    release.resolve(); outcome = await observed;
    assert.equal(outcome.ok, false); assert.ok(errorGraphIncludes(outcome.error, cancellation));
    if (siblings) assert.equal(descriptors.size, 4, 'cancelled fifth piece is never admitted');
    if (failedClose) {
      assert.ok(errorGraphIncludes(outcome.error, closeFailure));
      const values = graph(outcome.error), children = [...new Set(values.map(getContainedFileSession).filter(Boolean))];
      const publication = values.find(value => value.fileLockPublicationSession)?.fileLockPublicationSession;
      assert.equal(children.length, expectedReaders); assert.ok(publication);
      assert.equal(children.every(child => !child.isSettled()), true);
      assert.equal(isFileLockPublicationPending(lockPath), true);
      busyObservation = true; contender = withIndexStatePublicationLock(dir, () => { entered = true; });
      await busy.promise; assert.equal(entered, false, 'a cooperating publication remains physically fenced');
      allowClose = true;
      for (const child of children) await child.releaseAfterClose();
      await publication.releaseAfterClose();
      assert.equal(children.every(child => child.isSettled()), true); assert.equal(isFileLockPublicationPending(lockPath), false);
    }
    await contender; assert.equal(entered, true);
    await assert.rejects(fs.access(manifestPath), { code: 'ENOENT' });
    assert.equal([...descriptors.values()].every(entry => entry.closed), true);
    assert.equal(closeCalls, descriptors.size * (failedClose ? 2 : 1));
  }
} finally {
  allowClose = true; release.resolve(); await work?.catch(() => {});
  // Also join the observed original close callbacks when exercising the old
  // early-return owner; its public promise cannot be used as a drain witness.
  await Promise.all([...descriptors.values()].map(value => value.finished.promise));
  if (outcome?.error) for (const value of graph(outcome.error)) {
    await getContainedFileSession(value)?.releaseAfterClose().catch(() => {});
    await value.fileLockPublicationSession?.releaseAfterClose().catch(() => {});
  }
  await contender?.catch(() => {}); fs.open = originalOpen;
  for (const descriptor of descriptors.values()) if (!descriptor.closed) await descriptor.close().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Manifest checksum cancellation retains original reader settlement, publication fences and sealed sorted results.');
