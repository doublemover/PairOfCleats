import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const key = Symbol.for('poc.tests.lancedb-staged-replacement');
// Replace only the native connection import; Arrow resolves the real consumer package.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@lancedb/lancedb'
      && context.parentURL?.endsWith('/src/shared/optional-deps.js')) return { url: 'poc:lancedb-staged-replacement', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'poc:lancedb-staged-replacement') return { format: 'module', shortCircuit: true,
      source: `export const connect = dir => globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(key))})](dir);` };
    return nextLoad(url, context);
  }
});
const { dir: root } = await prepareIsolatedTestCacheDir('lancedb-staged-replacement');
const dir = path.join(root, 'dense_vectors.lancedb');
const metaPath = `${dir}.meta.json`;
const primary = Object.assign(new Error('controlled build failure'), { code: 'EIO' });
const cleanup = Object.assign(new Error('controlled cleanup failure'), { code: 'EIO' });
// Atomic persistence now retains operation context in AggregateError.cause.
// Require the exact injected primary to remain on that chain; a matching message
// or an unrelated cleanup error must never satisfy the fault assertion.
const hasPrimaryCause = error => {
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    if (current === primary) return true;
    seen.add(current);
  }
  return false;
};
let fault = null, closeFailure = false, rollbackFailure = false;
let publicationInjected = false;
let connections = 0, tableCloses = 0, databaseCloses = 0, tables = 0;
globalThis[key] = async target => {
  assert.notEqual(target, dir, 'native connection never opens the published directory for writes');
  if (fault === 'connect' || fault === 'cleanup') throw primary;
  connections++;
  let count = 0;
  return {
    async createTable(name, rows) {
      tables++;
      const dataset = path.join(target, `${name}.lance`);
      await fs.mkdir(path.join(dataset, '_versions'), { recursive: true });
      await fs.mkdir(path.join(dataset, 'data'));
      await fs.writeFile(path.join(dataset, '_versions/1.manifest'), 'fixture manifest');
      await fs.writeFile(path.join(dataset, 'data/1.lance'), 'fixture fragment');
      count = rows.numRows;
      return {
        async add(batch) { if (fault === 'add') throw primary; count += batch.numRows; },
        async schema() { return rows.schema; },
        async countRows() { if (fault === 'count') throw primary; return fault === 'count-mismatch' ? count - 1 : count; },
        async close() { tableCloses++; if (closeFailure) throw cleanup; }
      };
    },
    async close() { databaseCloses++; }
  };
};
const originalRename = fs.rename, originalRm = fs.rm;
fs.rename = async (from, to) => {
  if (fault === 'metadata' && to.endsWith('.meta.json') && path.basename(path.dirname(to)).startsWith('.lancedb-staging-')) throw primary;
  if (fault === 'publication' && to === metaPath && !publicationInjected) {
    publicationInjected = true;
    throw primary;
  }
  if (rollbackFailure && to === dir && path.basename(from).startsWith('.dense_vectors.lancedb.bak-')) throw cleanup;
  return originalRename(from, to);
};
fs.rm = async (target, options) => {
  if (fault === 'cleanup' && path.basename(target).startsWith('.lancedb-staging-')) throw cleanup;
  return originalRm(target, options);
};
try {
  const { writeLanceDbIndex } = await import('../../../tools/build/embeddings/lancedb.js');
  const { recoverLanceDbReplacement } = await import('../../../tools/build/embeddings/backend-publication.js');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'prior-index'), 'prior immutable bytes');
  const priorMeta = Buffer.from('{"prior":"metadata"}');
  await fs.writeFile(metaPath, priorMeta);
  const priorUnchanged = async () => {
    assert.equal(await fs.readFile(path.join(dir, 'prior-index'), 'utf8'), 'prior immutable bytes');
    assert.deepEqual(await fs.readFile(metaPath), priorMeta);
  };
  const write = () => writeLanceDbIndex({ indexDir: root, variant: 'merged', dims: 2,
    vectors: [[240, 128], [128, 240]], modelId: 'fixture', normalize: false,
    quantization: { minVal: -1, maxVal: 1, levels: 256 }, config: { enabled: true, isolate: false, batchSize: 1 },
    emitOutput: false, logger: { log() {}, warn(message) { assert.fail(`Unexpected warning: ${message}`); } } });
  for (fault of ['connect', 'add', 'count', 'count-mismatch', 'metadata', 'publication']) {
    await assert.rejects(write(), error => fault === 'count-mismatch'
      ? /insert count mismatch/.test(error.message)
      : ['metadata', 'publication'].includes(fault) ? hasPrimaryCause(error) : error === primary);
    await priorUnchanged();
    assert.equal((await fs.readdir(root)).some(name => name.startsWith('.lancedb-staging-')), false);
    assert.equal((await fs.readdir(root)).some(name => name.includes('.bak-')), false);
  }
  fault = 'add'; closeFailure = true;
  await assert.rejects(write(), error => error instanceof AggregateError && error.cause === primary
    && error.errors[0] === primary && error.errors[1] === cleanup);
  await priorUnchanged();
  closeFailure = false; fault = 'cleanup';
  await assert.rejects(write(), error => error instanceof AggregateError && error.cause === primary
    && error.errors.includes(cleanup) && /staging cleanup retained/.test(error.message));
  await priorUnchanged();
  fault = 'publication'; rollbackFailure = true; publicationInjected = false;
  await assert.rejects(write(), error => error instanceof AggregateError && hasPrimaryCause(error)
    && /recovery retained/.test(error.message));
  const journal = JSON.parse(await fs.readFile(`${metaPath}.publication.json`, 'utf8'));
  assert.equal(await fs.readFile(path.join(root, journal.backupPath, 'prior-index'), 'utf8'), 'prior immutable bytes');
  assert.deepEqual(await fs.readFile(path.join(root, journal.stageRoot, 'previous.meta.json')), priorMeta);
  fault = null; rollbackFailure = false;
  await recoverLanceDbReplacement({ dir, metaPath });
  await priorUnchanged();
  await assert.rejects(fs.stat(`${metaPath}.publication.json`), { code: 'ENOENT' });
  const result = await write();
  assert.equal(result.skipped, false);
  assert.equal(result.count, 2);
  assert.equal(JSON.parse(await fs.readFile(metaPath, 'utf8')).count, 2);
  assert.equal((await fs.readdir(root)).some(name => name.includes('.bak-')), false);
  assert.equal(tableCloses, tables, 'each acquired table closes after build or failure');
  assert.equal(databaseCloses, connections, 'each acquired connection closes after build or failure');
} finally {
  fs.rename = originalRename; fs.rm = originalRm;
  hooks.deregister(); delete globalThis[key];
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Staged LanceDB failures preserve prior bytes, primary errors, native lifetimes and recoverable rollback.');
