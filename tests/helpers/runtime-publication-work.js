import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reopenSemanticDiskAccount } from '../../src/index/build/incremental/working-set.js';
import { withRuntimeDestinationWriter } from '../../src/index/semantic/runtime/ownership.js';
import { runNode } from './run-node.js';

export const retainedRuntimeBytes = async destination =>
  (await reopenSemanticDiskAccount({ roots: [destination], limit: Number.MAX_SAFE_INTEGER })).retainedBytes;

export const admitRuntimeHeadroom = async (destination, headroom = 1024) => {
  const retained = await retainedRuntimeBytes(destination), limit = retained + headroom;
  await withRuntimeDestinationWriter({ destination, maxDiskWorkingSetBytes: limit }, () => {});
  return { retained, limit, headroom };
};

export const runtimeFamilySnapshot = async directory => {
  const result = [];
  for (const name of (await fs.readdir(directory)).sort()) {
    const filename = path.join(directory, name), stat = await fs.lstat(filename, { bigint: true });
    assert.ok(stat.isFile(), 'the immutable test family contains ordinary members only');
    result.push({ name, sha256: createHash('sha256').update(await fs.readFile(filename)).digest('hex'),
      size: String(stat.size), ino: String(stat.ino), dev: String(stat.dev), mtimeNs: String(stat.mtimeNs) });
  }
  return result;
};

/** Observe the original filesystem operations, not producer-declared counters.
 * Native query-index completion necessarily opens its real image for fsync.
 * A repeated family must create no staging, row writes or SQLite finalization. */
export const observeRuntimePublicationWork = async (destination, operation) => {
  const open = fs.open, mkdtemp = fs.mkdtemp;
  const witness = { staging: [], writes: [], sqliteFinalizations: 0, evidenceReadOpens: 0, evidenceReadBytes: 0 };
  const owned = filename => {
    const relative = path.relative(destination, path.resolve(String(filename)));
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  };
  fs.mkdtemp = async (...args) => {
    const result = await mkdtemp(...args);
    if (owned(result)) witness.staging.push(path.relative(destination, result).replaceAll('\\', '/'));
    return result;
  };
  fs.open = async (...args) => {
    const handle = await open(...args), filename = String(args[0]);
    if (!owned(filename)) return handle;
    if (path.basename(filename) === 'query.sqlite' && args[1] === 'r+') witness.sqliteFinalizations++;
    if (path.basename(filename) === 'evidence.jsonl' && (args[1] === 'r' || typeof args[1] === 'number')) {
      witness.evidenceReadOpens++;
      const read = handle.read;
      handle.read = async function (...readArgs) {
        const result = await read.apply(this, readArgs); witness.evidenceReadBytes += result.bytesRead; return result;
      };
    }
    const writeFile = handle.writeFile;
    handle.writeFile = async function (bytes, ...writeArgs) {
      const result = await writeFile.call(this, bytes, ...writeArgs);
      witness.writes.push({ path: path.relative(destination, filename).replaceAll('\\', '/'), bytes: Buffer.byteLength(bytes) });
      return result;
    };
    return handle;
  };
  try { return { value: await operation(), witness }; }
  finally { fs.open = open; fs.mkdtemp = mkdtemp; }
};

export const assertNoRuntimeFamilyWrites = witness => {
  assert.deepEqual(witness.staging, [], 'reuse must precede any duplicate publication/raw staging');
  assert.equal(witness.sqliteFinalizations, 0, 'no new native lookup image may be built');
  assert.deepEqual(witness.writes.filter(row => /^(generations|claims)\/[^.][^/]*\//.test(row.path)), [],
    'a reused immutable family cannot be overwritten');
  assert.deepEqual(witness.writes.filter(row => /\.pending-/.test(row.path)), [], 'no projected rows or temporary family members');
};

export const runRuntimeReuseChild = async ({ kind, options, requestFile }) => {
  await fs.writeFile(requestFile, JSON.stringify({ kind, options }));
  const result = runNode([path.join(process.cwd(), 'tests/fixtures/runtime/publication-reuse-child.js'), requestFile],
    'fresh runtime publication reuse', process.cwd(), process.env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout); assert.notEqual(value.pid, process.pid);
  return value;
};
