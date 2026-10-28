import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCallSitePages } from '../../src/graph/call-site-pages.js';
import { createRetainedEvidencePages } from '../../src/graph/retained-evidence-pages.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { buildCallSiteId } from '../../src/index/callsite-id.js';
import { validateArtifact } from '../../src/contracts/artifact-schemas.js';
import { writeJsonLinesFileAsync } from '../../src/shared/json-stream/jsonl-write.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { consumeJsonRows } from '../../src/shared/json-stream/consume-rows.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';

// Source controls only until the deferred Windows functional campaign executes.
const root = await makeTempDir('retained-enumeration-');
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const file = 'src/' + 'unicode-λ-'.repeat(20) + '.js', calleeRaw = 'invoke';
const rows = Array.from({ length: 320 }, (_, ordinal) => ({
  callSiteId: buildCallSiteId({ file, startLine: ordinal + 1, startCol: 1,
    endLine: ordinal + 1, endCol: 5, calleeRaw }), callerChunkUid: ordinal % 2 ? 'b' : 'a',
  targetChunkUid: ordinal % 7 ? 'target' : null, targetCandidates: ordinal % 7 ? [] : ['may-a', 'may-b'],
  file, start: ordinal * 10, end: ordinal * 10 + 4, startLine: ordinal + 1, startCol: 1,
  endLine: ordinal + 1, endCol: 5, languageId: 'javascript', args: [], calleeRaw, calleeNormalized: calleeRaw,
  extensions: { syntax: { producer: 'tree-sitter', coordinateSystem: 'utf16', role: 'call',
    resolution: ordinal % 7 ? 'resolved' : 'ambiguous', reason: 'fixture', rawPreviewTruncated: false } }
}));
const manifestFile = path.join(root, 'pieces', 'manifest.json');
const originalOpen = fs.open;
const undisposed = new Map();
try {
  assert.equal(validateArtifact('call_sites', rows).ok, true);
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  const pieces = [];
  for (const [part, selected] of [rows.slice(0, 160), rows.slice(160)].entries()) {
    const location = `call_sites.${part}.jsonl`, target = path.join(root, location);
    await writeJsonLinesFileAsync(target, selected, { atomic: true, offsets: { path: target + '.offsets.bin', atomic: true } });
    for (const [name, suffix] of [['call_sites', ''], ['call_sites_offsets', '.offsets.bin']]) {
      const bytes = await fs.readFile(target + suffix);
      pieces.push({ name, path: location + suffix, format: suffix ? 'bin' : 'jsonl',
        count: selected.length, bytes: bytes.length, checksum: hash(bytes) });
    }
  }
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'enumeration-generation', pieces };
  const restoreManifest = () => fs.writeFile(manifestFile, JSON.stringify(manifest));
  await restoreManifest();
  assert.ok(pieces.filter(piece => piece.name === 'call_sites').every(piece => piece.bytes > 65536));
  const create = () => createCallSitePages({ indexDir: root, manifest });
  const enumerate = async options => {
    const iterator = create().iteratePages(options), output = [], pages = [];
    for await (const page of iterator) { output.push(...page.rows); pages.push(page); }
    return { output, pages, work: iterator.getDiagnostics() };
  };
  const one = await enumerate({ limit: 1, scanRows: 1 });
  const small = await enumerate({ limit: 7, scanRows: 11 });
  const normal = await enumerate({ limit: 128, scanRows: 256 });
  for (const result of [one, small, normal]) {
    assert.deepEqual(result.output, rows);
    assert.equal(result.work.filesHashed, 4);
    assert.equal(result.work.fileHashAttempts, 4);
    assert.equal(result.work.bytesHashed, pieces.reduce((sum, piece) => sum + piece.bytes, 0));
    assert.equal(result.work.offsetEntriesValidated, rows.length);
    assert.equal(result.work.rowsDecoded, rows.length);
    assert.equal(result.work.sourceOpens, 4);
    assert.equal(result.work.retainedProofBytes, 0);
    assert.equal(result.work.retainedDescriptorUpperBound, 0);
    assert.equal(result.work.peakDescriptorUpperBound, 2);
    assert.ok(result.work.peakDecodedWindowBytes <= 32 * 32768);
    assert.ok(result.work.peakRetainedProofBytes <= Math.ceil(Math.max(...pieces.map(piece => piece.bytes)) / 65536) * 32 + 32);
  }
  assert.ok(normal.work.rowReadWindows < one.work.rowReadWindows);
  assert.ok(normal.work.dataBlocksVerified < one.work.dataBlocksVerified,
    'actual positioned block verification coalesces bounded adjacent windows');
  assert.ok(normal.work.physicalReadBytes < one.work.physicalReadBytes);
  const selective = await enumerate({ limit: 3, scanRows: 7, filter: { callerChunkUid: 'b' } });
  assert.deepEqual(selective.output, rows.filter(row => row.callerChunkUid === 'b'));
  const miss = await enumerate({ limit: 2, scanRows: 3, filter: { file: 'missing' } });
  assert.deepEqual(miss.output, []); assert.ok(miss.pages.length > 1);
  assert.ok(miss.pages.slice(0, -1).every(page => page.cursor && !page.done));
  assert.equal(miss.work.rowsDecoded, rows.length); assert.equal(miss.work.filesHashed, 4);
  assert.ok(miss.work.physicalReadBytes > 0, 'an empty output is not zero physical work');

  const broken = create().iteratePages({ limit: 1 });
  await broken.next(); assert.equal(broken.getDiagnostics().retainedDescriptorUpperBound, 2);
  await broken.return(); assert.equal(broken.getDiagnostics().retainedDescriptorUpperBound, 0);
  const controller = new AbortController(), cancelled = create().iteratePages({ limit: 1, signal: controller.signal });
  await cancelled.next(); controller.abort();
  await assert.rejects(cancelled.next(), { name: 'AbortError' });
  assert.equal(cancelled.getDiagnostics().retainedDescriptorUpperBound, 0);
  const invalidated = create().iteratePages({ limit: 1 }); await invalidated.next();
  await fs.writeFile(manifestFile, JSON.stringify({ ...manifest, buildId: 'changed' }));
  await assert.rejects(invalidated.next(), { code: 'ERR_CALL_SITE_CURSOR_SCOPE' });
  assert.equal(invalidated.getDiagnostics().retainedDescriptorUpperBound, 0); await restoreManifest();

  const dataFile = path.join(root, pieces[0].path), original = await fs.readFile(dataFile), stat = await fs.stat(dataFile);
  const changed = create().iteratePages({ limit: 1 }); await changed.next();
  const replacement = Buffer.from(original); replacement[replacement.indexOf('invoke')] = 73;
  await fs.writeFile(dataFile, replacement); await fs.utimes(dataFile, stat.atime, stat.mtime);
  await assert.rejects(changed.next(), { code: 'ERR_JSONL_CONTENT_INTEGRITY' });
  assert.equal(changed.getDiagnostics().retainedDescriptorUpperBound, 0); await fs.writeFile(dataFile, original);

  const temporary = dataFile + '.replacement'; await fs.writeFile(temporary, original);
  const replacementIdentity = await fs.stat(temporary, { bigint: true });
  const statSync = fsSync.statSync;
  let observeReplacement = false;
  // Windows can deny replacing a retained descriptor. Preserve that actual
  // observation, then qualify the identity check using the second real inode.
  fsSync.statSync = function(location, ...args) {
    if (observeReplacement && path.resolve(String(location)) === dataFile) return replacementIdentity;
    return statSync.call(this, location, ...args);
  };
  try {
    const replaced = create().iteratePages({ limit: 1 }); await replaced.next();
    try { await fs.rename(temporary, dataFile); }
    catch (error) {
      assert.equal(process.platform, 'win32'); assert.equal(error.code, 'EPERM');
      assert.deepEqual(await fs.readFile(dataFile), original);
      assert.notEqual(replacementIdentity.ino, (await fs.stat(dataFile, { bigint: true })).ino);
      observeReplacement = true;
    }
    await assert.rejects(replaced.next(), error => ['ERR_UNSAFE_FILE_PATH', 'ERR_FILE_CHANGED', 'ERR_JSONL_CONTENT_INTEGRITY'].includes(error.code));
    assert.equal(replaced.getDiagnostics().retainedDescriptorUpperBound, 0);
  } finally { fsSync.statSync = statSync; }

  let opened = 0;
  fs.open = async (location, ...args) => {
    if (String(location).endsWith('.jsonl') || String(location).endsWith('.offsets.bin')) opened++;
    return originalOpen(location, ...args);
  };
  const independent = create(), first = await independent.readPage({ limit: 1 });
  await independent.readPage({ limit: 1, cursor: first.cursor });
  assert.equal(opened, 4, 'independent requests never borrow an enumeration proof');
  fs.open = originalOpen;

  const primary = Object.freeze(new Error('bounded window selection failure'));
  const failing = createRetainedEvidencePages({ indexDir: root, manifest, family: 'call_sites', ordering: 'fixture',
    errorPrefix: 'CALL_SITE', normalizeFilter: value => value, validateRow: () => true, matches: () => { throw primary; } }).iteratePages();
  await assert.rejects(failing.next(), error => error === primary || error.cause === primary);
  assert.equal(failing.getDiagnostics().retainedDescriptorUpperBound, 0);

  const cleanup = Object.freeze(new Error('original enumeration descriptor close failed'));
  let allowClose = false, closeAttempts = 0, readCalls = 0;
  fs.open = async (location, ...args) => {
    const handle = await originalOpen(location, ...args);
    if (path.resolve(String(location)) !== dataFile) return handle;
    const close = handle.close, read = handle.read;
    undisposed.set(handle, () => close.call(handle));
    handle.read = function(...values) { readCalls++; return read.call(handle, ...values); };
    handle.close = async function() {
      closeAttempts++;
      if (!allowClose) throw cleanup;
      await close.call(handle); undisposed.delete(handle);
    };
    return handle;
  };
  const outputFailure = Object.freeze(new Error('original output consumer failed'));
  let combined;
  try { await consumeJsonRows(create().iteratePages({ limit: 1 }), () => { throw outputFailure; }); }
  catch (error) { combined = error; }
  assert.ok(combined);
  const originals = [], sessions = new Set(), queue = [combined], visited = new Set();
  while (queue.length) {
    const value = queue.pop(); originals.push(value);
    if (value === null || !['object', 'function'].includes(typeof value) || visited.has(value)) continue;
    visited.add(value);
    const session = getContainedFileSession(value); if (session) sessions.add(session);
    if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  assert.ok(originals.includes(outputFailure)); assert.ok(originals.includes(cleanup));
  assert.equal(closeAttempts, 1); assert.equal(combined.cacheOwnershipReleased(), false);
  assert.equal(sessions.size, 1);
  const beforeRecovery = readCalls; allowClose = true;
  for (const session of sessions) assert.equal((await session.releaseAfterClose()).settled, true);
  assert.equal(readCalls, beforeRecovery, 'recovery closes the original owner without replaying reads or output');
  assert.equal(combined.cacheOwnershipReleased(), true);
} finally {
  fs.open = originalOpen;
  for (const dispose of undisposed.values()) { try { await dispose(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Owned retained enumeration verifies each piece once, coalesces bounded windows and drains on exhaustion, return, abort and integrity failure.');
