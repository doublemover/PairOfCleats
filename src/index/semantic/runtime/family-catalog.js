import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, verifyContainedFileHandle, withContainedFile } from '../../../shared/contained-file.js';
import { acquireContainedFileResource } from '../../../shared/contained-file-resource.js';
import { syncParentDirectory } from '../../../shared/io/directory-sync.js';
import { readExactAt } from '../../../shared/io/read-exact.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { canonicalSemanticJson } from '../identity.js';
import { runtimeByteHash, runtimeImportError, assertRuntimeDiskReserve } from './raw-store.js';
import { publishRuntimeControl, isMissingRuntimeMember } from './control-publication.js';
import { readRuntimeMemberJson } from './verified-reads.js';
import { closeRuntimeResources } from './close-resources.js';
import { assertRuntimeDestinationWriter } from './destination-writer-context.js';

const VERSION = 1, HEADER_BYTES = 128, NODE_BYTES = 4096;
const CONTROL = 'family-catalog.json', STORE = 'family-catalog.bin';
const hex = /^[a-f0-9]{64}$/, storeId = /^[a-f0-9]{32}$/;
const bad = message => runtimeImportError('Runtime family catalog: ' + message + ' Re-ingest into a fresh destination.', 'ERR_RUNTIME_CATALOG_REQUIRED');
const own = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const validRef = (ref, extent) => own(ref, ['offset', 'bytes', 'hash', 'count'])
  && Number.isSafeInteger(ref.offset) && ref.offset >= HEADER_BYTES && Number.isSafeInteger(ref.bytes)
  && ref.bytes > 0 && ref.bytes <= NODE_BYTES && Number.isSafeInteger(ref.offset + ref.bytes)
  && ref.offset + ref.bytes <= extent && typeof ref.hash === 'string' && hex.test(ref.hash) && Number.isSafeInteger(ref.count) && ref.count > 0;
const validControl = value => own(value, ['version', 'storeId', 'extent', 'commit']) && value.version === VERSION
  && typeof value.storeId === 'string' && storeId.test(value.storeId) && Number.isSafeInteger(value.extent) && value.extent >= HEADER_BYTES
  && (value.commit === null ? value.extent === HEADER_BYTES
    : validRef(value.commit, value.extent) && value.commit.count === 1 && value.commit.offset + value.commit.bytes === value.extent);
const decode = buffer => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch (cause) { throw Object.assign(bad('malformed UTF-8 JSON.'), { cause }); }
};
const encoded = value => Buffer.from(canonicalSemanticJson(value) + '\n');
const headerBytes = id => {
  const buffer = Buffer.alloc(HEADER_BYTES, 32), json = encoded({ owner: 'runtime-family-catalog', version: VERSION, storeId: id });
  json.copy(buffer); return buffer;
};
const withCatalogStore = async (destination, action) => {
  try { return await withContainedFile(destination, path.join(destination, STORE), action); }
  catch (error) { if (isMissingRuntimeMember(error)) throw bad('missing node store.'); throw error; }
};

/** Constant-size control admission. A missing catalog never initiates a scan. */
export const readRuntimeFamilyCatalog = async ({ destination, signal = null, metrics = null }) => {
  let value;
  try { value = (await readRuntimeMemberJson({ root: destination, relativePath: CONTROL, maxBytes: NODE_BYTES, signal, metrics })).value; }
  catch (error) {
    if (isMissingRuntimeMember(error)) throw bad('missing current catalog.');
    if (error instanceof SyntaxError) throw bad('malformed current catalog JSON.');
    throw error;
  }
  if (!validControl(value)) throw bad('unsupported or malformed current catalog.');
  return value;
};

const readSpan = async (descriptor, offset, bytes, check) => {
  check();
  const buffer = Buffer.allocUnsafe(bytes);
  const guarded = { read: (...args) => { check(); return descriptor.read(...args); } };
  if ((await readExactAt(guarded, buffer, 0, bytes, offset)).bytesRead !== bytes) throw bad('truncated node store.');
  check(); return buffer;
};
const verifyHeader = async (descriptor, catalog, check) => {
  const stat = await descriptor.stat();
  if (!stat.isFile() || stat.size < catalog.extent) throw bad('store is shorter than its committed snapshot.');
  const header = decode(await readSpan(descriptor, 0, HEADER_BYTES, check));
  if (!own(header, ['owner', 'version', 'storeId']) || header.owner !== 'runtime-family-catalog'
    || header.version !== VERSION || header.storeId !== catalog.storeId) throw bad('store identity mismatch.');
};
const createNodeReader = (descriptor, { extent, check, metrics = null, maxReads = 66 }) => {
  const cache = new Map(); let reads = 0;
  const read = async ref => {
    check();
    if (!validRef(ref, extent)) throw bad('invalid node reference.');
    const key = ref.offset + ':' + ref.bytes + ':' + ref.hash + ':' + ref.count;
    if (cache.has(key)) {
      const node = cache.get(key); cache.delete(key); cache.set(key, node); return node;
    }
    if (++reads > maxReads) throw runtimeImportError('Runtime family catalog node-read allowance exceeded.', 'ERR_RUNTIME_QUERY_BUDGET');
    const bytes = await readSpan(descriptor, ref.offset, ref.bytes, check);
    if (metrics) { metrics.catalogNodeReads = (metrics.catalogNodeReads || 0) + 1; metrics.catalogReadBytes = (metrics.catalogReadBytes || 0) + bytes.length; }
    if (runtimeByteHash(bytes) !== ref.hash) throw bad('node checksum mismatch.');
    let node;
    try { node = decode(bytes); } catch { throw bad('malformed node JSON.'); }
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw bad('invalid node shape.');
    if (node.type === 'leaf') {
      if (!own(node, ['type', 'key']) || typeof node.key !== 'string' || !hex.test(node.key) || ref.count !== 1) throw bad('invalid leaf.');
    } else if (node.type === 'branch') {
      if (!own(node, ['type', 'prefix', 'children']) || typeof node.prefix !== 'string'
        || !/^[a-f0-9]{0,63}$/.test(node.prefix) || !Array.isArray(node.children)
        || node.children.length < 2 || node.children.length > 16) throw bad('invalid branch.');
      let previous = '', count = 0;
      for (const child of node.children) {
        if (!own(child, ['digit', 'ref']) || typeof child.digit !== 'string' || !/^[a-f0-9]$/.test(child.digit)
          || child.digit <= previous || !validRef(child.ref, ref.offset)) throw bad('invalid ordered child.');
        previous = child.digit; count += child.ref.count;
      }
      if (!Number.isSafeInteger(count) || count !== ref.count) throw bad('branch count mismatch.');
    } else if (node.type === 'commit') {
      if (!own(node, ['type', 'sequence', 'root', 'previous']) || !Number.isSafeInteger(node.sequence) || node.sequence < 1
        || !validRef(node.root, ref.offset) || (node.sequence === 1 ? node.previous !== null : !validRef(node.previous, ref.offset))
        || ref.count !== 1) throw bad('invalid commit.');
    } else throw bad('unknown node type.');
    cache.set(key, node); if (cache.size > 64) cache.delete(cache.keys().next().value);
    return node;
  };
  return { read, get reads() { return reads; } };
};
const treeNode = async (reader, ref, prefix = '') => {
  const node = await reader.read(ref), actual = node.type === 'leaf' ? node.key : node.prefix;
  if (node.type === 'commit' || !actual.startsWith(prefix) || (node.type === 'branch' && actual.length < prefix.length)) throw bad('tree prefix mismatch.');
  return node;
};

/** Snapshot cursors pin one published commit in this append-only store. Later
 * imports on either side of the cursor appear only in a fresh discovery pass.
 * Only O(depth + page) identities/nodes are retained; no directory enumeration.
 */
export const pageRuntimeFamilyCatalog = async ({ destination, snapshot = null, after = '', limit,
  maxReads, check, signal = null, metrics = null }) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(maxReads)
    || maxReads < 1 || maxReads > 100000 || typeof check !== 'function'
    || typeof after !== 'string' || after !== '' && !hex.test(after)) throw new TypeError('Invalid runtime catalog page allowance.');
  if (after && snapshot === null) throw runtimeImportError('Runtime discovery continuation requires its original snapshot.', 'ERR_RUNTIME_QUERY_CURSOR');
  check();
  const current = await readRuntimeFamilyCatalog({ destination, signal, metrics });
  const selected = snapshot === null ? current : snapshot;
  if (!validControl(selected) || selected.storeId !== current.storeId || selected.extent > current.extent) throw bad('cursor snapshot is unavailable.');
  return withCatalogStore(destination, async descriptor => {
    await verifyHeader(descriptor, current, check);
    const reader = createNodeReader(descriptor, { extent: current.extent, check, metrics, maxReads });
    const currentCommit = current.commit ? await reader.read(current.commit) : null;
    const commit = selected.commit ? await reader.read(selected.commit) : null;
    if (commit && (commit.type !== 'commit' || currentCommit?.type !== 'commit' || commit.sequence > currentCommit.sequence)) throw bad('snapshot commit is not published.');
    if (after) {
      let ref = commit?.root, prefix = '', found = false;
      while (ref) {
        const node = await treeNode(reader, ref, prefix);
        if (node.type === 'leaf') { found = node.key === after; break; }
        if (!after.startsWith(node.prefix)) break;
        const child = node.children.find(row => row.digit === after[node.prefix.length]);
        ref = child?.ref; prefix = node.prefix + (child?.digit || '');
      }
      if (!found) throw runtimeImportError('Runtime discovery boundary is not in its catalog snapshot.', 'ERR_RUNTIME_QUERY_CURSOR');
    }
    const keys = [];
    const visit = async (ref, prefix = '') => {
      check();
      if (after && !after.startsWith(prefix) && prefix < after) return;
      const node = await treeNode(reader, ref, prefix);
      if (node.type === 'leaf') { if (node.key > after) keys.push(node.key); return; }
      for (const child of node.children) {
        if (keys.length >= limit + 1) break;
        await visit(child.ref, node.prefix + child.digit);
      }
    };
    if (commit) await visit(commit.root);
    descriptor.verify(); check();
    return { snapshot: selected, keys, nodeReads: reader.reads };
  });
};

/** Initialize only an empty destination. Existing uncataloged families require
 * re-ingestion rather than a hidden interactive rebuild or partial adoption.
 * An interrupted initial header can be reused only while generations is empty.
 */
export const prepareRuntimeFamilyCatalog = async ({ destination, account, diskReserveBytes, signal, work }) => {
  assertRuntimeDestinationWriter(destination, account);
  try { return await readRuntimeFamilyCatalog({ destination, signal }); }
  catch (error) { if (error.code !== 'ERR_RUNTIME_CATALOG_REQUIRED') throw error;
    // A present malformed control is never treated as a missing first install.
    try { await fs.lstat(path.join(destination, CONTROL)); throw error; } catch (presence) { if (!isMissingRuntimeMember(presence)) throw presence; }
  }
  try {
    assertNoSymlinkPath(destination, path.join(destination, 'generations'), { allowMissing: true });
    const directory = await fs.opendir(path.join(destination, 'generations'));
    const close = directory.close.bind(directory);
    let failed = false, failure;
    try { if (await directory.read()) throw bad('uncataloged destination is not empty.'); }
    catch (error) { failed = true; failure = error; throw error; }
    finally { await closeRuntimeResources([{ close }], failure, { hasOperationError: failed }); }
  } catch (error) { if (!isMissingRuntimeMember(error)) throw error; }
  let id;
  try {
    await withContainedFile(destination, path.join(destination, STORE), async descriptor => {
      const stat = await descriptor.stat();
      if (stat.size !== HEADER_BYTES) throw bad('unpublished initial store has extra data.');
      const header = decode(await readSpan(descriptor, 0, HEADER_BYTES, () => throwIfAborted(signal)));
      if (!own(header, ['owner', 'version', 'storeId']) || header.owner !== 'runtime-family-catalog'
        || header.version !== VERSION || typeof header.storeId !== 'string'
        || !storeId.test(header.storeId)) throw bad('invalid initial store.');
      descriptor.verify(); id = header.storeId;
    });
  } catch (error) {
    if (!isMissingRuntimeMember(error)) throw error;
    id = randomUUID().replaceAll('-', ''); const bytes = headerBytes(id);
    await assertRuntimeDiskReserve({ destination, diskReserveBytes, additionalBytes: bytes.length });
    account.reserve(bytes.length);
    const filename = path.join(destination, STORE); assertNoSymlinkPath(destination, filename, { allowMissing: true });
    const owner = await acquireContainedFileResource(() => fs.open(filename, 'wx+'), { additionalMethods: ['writeFile', 'sync'] });
    await owner.run(async descriptor => {
      verifyContainedFileHandle(descriptor.fd, destination, filename);
      await descriptor.writeFile(bytes); work.add('fileWriteBytes', bytes.length); await descriptor.sync();
      throwIfAborted(signal); verifyContainedFileHandle(descriptor.fd, destination, filename);
    });
  }
  const catalog = { version: VERSION, storeId: id, extent: HEADER_BYTES, commit: null };
  await publishRuntimeControl({ root: destination, relativePath: CONTROL, bytes: encoded(catalog), account, diskReserveBytes, signal, work,
    check: () => { assertRuntimeDestinationWriter(destination, account); throwIfAborted(signal); } });
  await syncParentDirectory(path.join(destination, CONTROL));
  return catalog;
};

/** Append copy-on-write compressed radix nodes, sync/close the original store,
 * then atomically publish its bounded commit selector under the existing writer.
 * Failed append tails are outside the committed extent and trimmed on retry.
 */
export const registerRuntimeFamily = async ({ destination, generationId, account, diskReserveBytes, signal = null, work }) => {
  assertRuntimeDestinationWriter(destination, account);
  if (!hex.test(generationId)) throw bad('invalid generation identity.');
  const catalog = await readRuntimeFamilyCatalog({ destination, signal });
  const filename = path.join(destination, STORE); assertNoSymlinkPath(destination, filename);
  const owner = await acquireContainedFileResource(() => fs.open(filename, 'r+'), { additionalMethods: ['write', 'truncate', 'sync'] });
  const check = () => { assertRuntimeDestinationWriter(destination, account); throwIfAborted(signal); };
  let extent = catalog.extent, commitRef;
  await owner.run(async descriptor => {
    verifyContainedFileHandle(descriptor.fd, destination, filename); await verifyHeader(descriptor, catalog, check);
    const originalStat = await descriptor.stat();
    if (originalStat.nlink !== 1) throw bad('writable store has external hardlink aliases.');
    const reader = createNodeReader(descriptor, { extent: catalog.extent, check });
    const prior = catalog.commit ? await reader.read(catalog.commit) : null;
    if (prior && prior.type !== 'commit') throw bad('selected node is not a commit.');
    const chunks = [];
    const append = (node, count) => {
      check(); const bytes = encoded(node);
      if (bytes.length > NODE_BYTES) throw bad('node exceeds its fixed allowance.');
      const ref = { offset: extent, bytes: bytes.length, hash: runtimeByteHash(bytes), count };
      if (!Number.isSafeInteger(extent + bytes.length)) throw bad('append range exceeds safe integer coordinates.');
      chunks.push(bytes);
      if (chunks.length > 66) throw bad('append exceeds the fixed radix-depth allowance.');
      extent += bytes.length; return ref;
    };
    const branch = children => children.sort((a, b) => a.digit < b.digit ? -1 : 1);
    const insert = async (ref, prefix = '') => {
      const node = await treeNode(reader, ref, prefix), key = node.type === 'leaf' ? node.key : node.prefix;
      if (node.type === 'leaf' && key === generationId) return ref;
      let common = 0; while (common < key.length && key[common] === generationId[common]) common++;
      if (common < key.length) {
        const leaf = await append({ type: 'leaf', key: generationId }, 1);
        return append({ type: 'branch', prefix: key.slice(0, common), children: branch([
          { digit: key[common], ref }, { digit: generationId[common], ref: leaf }]) }, ref.count + 1);
      }
      const digit = generationId[key.length], children = [...node.children], index = children.findIndex(child => child.digit === digit);
      if (index < 0) children.push({ digit, ref: await append({ type: 'leaf', key: generationId }, 1) });
      else {
        const child = children[index], next = await insert(child.ref, key + digit);
        if (next === child.ref) return ref;
        children[index] = { digit, ref: next };
      }
      return append({ type: 'branch', prefix: key, children: branch(children) }, ref.count + 1);
    };
    const root = prior ? await insert(prior.root) : await append({ type: 'leaf', key: generationId }, 1);
    if (prior && root === prior.root) return;
    commitRef = await append({ type: 'commit', sequence: (prior?.sequence || 0) + 1, root, previous: catalog.commit }, 1);
    const bytes = Buffer.concat(chunks);
    if (originalStat.size > catalog.extent) {
      await descriptor.truncate(catalog.extent);
      if ((await descriptor.stat()).size !== catalog.extent) throw bad('unpublished tail did not retire.');
      account.release(originalStat.size - catalog.extent);
    }
    await assertRuntimeDiskReserve({ destination, diskReserveBytes, additionalBytes: bytes.length });
    account.reserve(bytes.length);
    let written = 0;
    while (written < bytes.length) {
      check(); const { bytesWritten } = await descriptor.write(bytes, written, bytes.length - written, catalog.extent + written);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > bytes.length - written) throw bad('invalid append progress.');
      written += bytesWritten; work.add('fileWriteBytes', bytesWritten);
    }
    await descriptor.sync(); verifyContainedFileHandle(descriptor.fd, destination, filename); check();
  });
  if (!commitRef) return false;
  const next = { ...catalog, extent, commit: commitRef };
  await publishRuntimeControl({ root: destination, relativePath: CONTROL, bytes: encoded(next), account, diskReserveBytes, signal, work, check });
  await syncParentDirectory(path.join(destination, CONTROL));
  return true;
};
