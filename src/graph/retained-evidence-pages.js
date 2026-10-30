import path from 'node:path';
import { validateArtifact } from '../contracts/artifact-schemas.js';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { readJsonFile } from '../shared/artifact-io/json.js';
import { assertPiecesManifestFormat } from '../shared/artifact-io/manifest-read.js';
import { resolveManifestPath } from '../shared/artifact-io/manifest-paths.js';
import { sortManifestEntries } from '../shared/artifact-io/manifest-entry-selection.js';
import { createRetainedEvidenceSession } from './retained-evidence-session.js';
import { semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';

const MAX_ROWS = 512;
const MAX_SCAN_ROWS = 4096;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_ROW_BYTES = 32768;
const MAX_WINDOW_ROWS = 32;
const normalizeManifest = raw => raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
const manifestHash = manifest => semanticHash('graph.retained-evidence.publication.v1', manifest);
const checksum = (piece, fail) => {
  const match = /^(sha1|sha256|xxh64):([a-f0-9]+)$/.exec(piece?.checksum || '');
  if (!match || match[2].length !== ({ sha1: 40, sha256: 64, xxh64: 16 }[match[1]])) throw fail('Retained-evidence paging requires registered content checksums.');
  return { algorithm: match[1], value: match[2] };
};
const bounded = (value, fallback, maximum) => {
  const next = value ?? fallback;
  if (!Number.isSafeInteger(next) || next < 1 || next > maximum) throw new TypeError('Retained-evidence page limit is outside its bounded contract.');
  return next;
};
/** Generation-pinned enumeration of canonical, retained relationship evidence.
 * Offsets and data are verified on the same retained handles as positioned reads.
 * Query limits bound hydration/scan work, never the retained evidence inventory.
 * A single page owns an independent session. Whole enumerations retain at most
 * one verified pair and one <=32-row (<=1 MiB encoded) decode window. Counters
 * distinguish physical verification/reads from logical scanned/output bytes.
 */
export const createRetainedEvidencePages = ({ indexDir, manifest, maxBytes = MAX_JSON_BYTES,
  family, ordering, normalizeFilter, matches, validateRow, errorPrefix, maxRowBytes = MAX_ROW_BYTES }) => {
  const fail = (message, code = 'ERR_CALL_SITE_PAGE_INTEGRITY') => Object.assign(new Error(message), {
    code: code.replace('ERR_CALL_SITE_', 'ERR_' + errorPrefix + '_')
  });
  const ORDER = ordering;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('Retained-evidence piece read allowance must be positive and bounded.');
  bounded(maxRowBytes, MAX_ROW_BYTES, MAX_ROW_BYTES);
  const pinned = structuredClone(manifest);
  assertPiecesManifestFormat(indexDir, pinned);
  const scope = semanticHash('graph.retained-evidence.cursor-scope.v2', {
    root: path.resolve(indexDir), manifest: pinned, family, ordering: ORDER
  });
  const pinnedHash = manifestHash(pinned);
  let parts = null;
  const loadParts = async signal => {
    if (parts) return parts;
    let pieces = sortManifestEntries(pinned.pieces.filter(piece => piece.name === family));
    if (new Set(pieces.map(piece => piece.path)).size !== pieces.length) throw fail('Duplicate retained-evidence physical inventory.');
    const metadata = pinned.pieces.filter(piece => piece.name === family + '_meta');
    if (metadata.length > 1) throw fail('Ambiguous retained-evidence metadata.');
    if (metadata.length) {
      const piece = metadata[0], expected = checksum(piece, fail);
      if (!Number.isSafeInteger(piece.bytes) || piece.bytes < 0 || piece.bytes > maxBytes) throw fail('Invalid retained-evidence metadata byte allowance.');
      const { buffer } = await readVerifiedContainedFile(indexDir, resolveManifestPath(indexDir, piece.path, true), {
        maxBytes, expectedBytes: piece.bytes, signal,
        ...(expected.algorithm === 'xxh64' ? {} : { expectedHash: expected.value, hashAlgorithm: expected.algorithm })
      });
      if (expected.algorithm === 'xxh64') {
        const hasher = await (await import('../shared/hash/xxhash-backend.js')).createXxhash64Hasher();
        hasher.update(buffer);
        if (hasher.digest() !== expected.value) throw fail('Retained-evidence metadata checksum mismatch.');
      }
      const meta = normalizeManifest(JSON.parse(buffer.toString('utf8')));
      if (!validateArtifact(family + '_meta', meta).ok || meta.artifact !== family || meta.compression !== 'none') {
        throw fail('Unsupported or invalid retained-evidence metadata.', 'ERR_CALL_SITE_PAGING_UNAVAILABLE');
      }
      const byPath = new Map(pieces.map(part => [part.path, part]));
      const paths = meta.parts.map(part => typeof part === 'string' ? part : part.path);
      if (paths.length !== pieces.length || new Set(paths).size !== paths.length || paths.some(file => !byPath.has(file))
      || meta.totalRecords !== pieces.reduce((sum, part) => sum + part.count, 0)
      || meta.totalBytes !== pieces.reduce((sum, part) => sum + part.bytes, 0)) throw fail('Retained-evidence metadata disagrees with registered physical inventory.');
      pieces = paths.map(file => byPath.get(file));
    } else if (!pieces.length) throw fail('Retained-evidence family is not registered.', 'ERR_CALL_SITE_PAGING_UNAVAILABLE');
    const selected = pieces.map(piece => {
      if (!piece.path?.endsWith('.jsonl') || piece.compression && piece.compression !== 'none') {
        throw fail('This retained evidence representation has no positioned JSONL page route.', 'ERR_CALL_SITE_PAGING_UNAVAILABLE');
      }
      const offsets = pinned.pieces.find(candidate => candidate.name === family + '_offsets'
      && candidate.path === piece.path + '.offsets.bin');
      if (!offsets || !Number.isSafeInteger(piece.count) || piece.count < 0 || piece.count > piece.bytes
      || offsets.count !== piece.count || !Number.isSafeInteger(piece.bytes) || piece.bytes < 0
      || !Number.isSafeInteger(offsets.bytes) || offsets.bytes !== piece.count * 8
      || piece.bytes > maxBytes) throw fail('Retained-evidence piece/offset inventory is incomplete or exceeds its read allowance.');
      return { piece, offsets, dataHash: checksum(piece, fail), offsetsHash: checksum(offsets, fail) };
    });
    throwIfAborted(signal);
    parts = selected;
    return parts;
  };
  const assertPublication = () => {
    // Bypass timestamp caches: equal metadata does not qualify the same generation.
    const current = normalizeManifest(readJsonFile(path.join(indexDir, 'pieces', 'manifest.json'), {
      maxBytes, containedRoot: indexDir, recoveryFallback: false
    }));
    if (manifestHash(current) !== pinnedHash) throw fail('Retained-evidence cursor publication changed.', 'ERR_CALL_SITE_CURSOR_SCOPE');
  };
  const readOwnedPage = async (session, { filter: inputFilter = {}, cursor = null, limit = 128,
    scanRows = 1024, maxPageBytes = 1024 * 1024, signal = null } = {}) => {
    throwIfAborted(signal);
    await loadParts(signal);
    throwIfAborted(signal);
    const filter = normalizeFilter(inputFilter);
    const rowsLimit = bounded(limit, 128, MAX_ROWS);
    const scanLimit = bounded(scanRows, 1024, MAX_SCAN_ROWS);
    const bytesLimit = bounded(maxPageBytes, 1024 * 1024, MAX_PAGE_BYTES);
    const query = semanticHash('graph.retained-evidence.query.v1', { filter, ordering: ORDER });
    let position = { part: 0, row: 0 };
    if (cursor !== null) {
      let parsed;
      try {
        if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      } catch { throw fail('Invalid retained-evidence cursor.', 'ERR_CALL_SITE_CURSOR_SCOPE'); }
      if (parsed.version !== 1 || parsed.scope !== scope || parsed.query !== query
        || Object.keys(parsed).sort().join(',') !== 'part,query,row,scope,version'
        || !Number.isSafeInteger(parsed.part) || parsed.part < 0 || parsed.part > parts.length
        || !Number.isSafeInteger(parsed.row) || parsed.row < 0
        || (parsed.part === parts.length ? parsed.row !== 0 : parsed.row > parts[parsed.part].piece.count)) {
        throw fail('Retained-evidence cursor differs from this publication/query.', 'ERR_CALL_SITE_CURSOR_SCOPE');
      }
      position = { part: parsed.part, row: parsed.row };
    }
    assertPublication();
    const rows = [];
    let scanned = 0, bytes = 0;
    while (position.part < parts.length && scanned < scanLimit && rows.length < rowsLimit) {
      throwIfAborted(signal);
      const { piece } = parts[position.part];
      if (position.row === piece.count) { position = { part: position.part + 1, row: 0 }; continue; }
      let pageFull = false;
      while (position.row < piece.count && scanned < scanLimit && rows.length < rowsLimit && !pageFull) {
        const count = Math.min(MAX_WINDOW_ROWS, piece.count - position.row, scanLimit - scanned, rowsLimit - rows.length);
        const window = await session.readRows(parts[position.part], position.part,
          Array.from({ length: count }, (_, offset) => position.row + offset), { maxBytes: maxRowBytes, signal });
        // Every physically admitted row is checked, including filtered rows and
        // bounded overfetch when output bytes fill before the decode window.
        if (window.some(row => !validateRow(row))) throw fail('Invalid canonical retained-evidence row.');
        for (const row of window) {
          throwIfAborted(signal);
          const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
          if (matches(row, filter)) {
            if (rowBytes > bytesLimit && !rows.length) throw fail('Page byte allowance cannot contain the next occurrence.', 'ERR_CALL_SITE_PAGE_BYTES');
            if (bytes + rowBytes > bytesLimit) { pageFull = true; break; }
            rows.push(row); bytes += rowBytes;
          }
          position.row += 1; scanned += 1;
        }
      }
      if (position.row === piece.count) {
        await session.releasePiece();
        position = { part: position.part + 1, row: 0 };
      }
      else break;
    }
    assertPublication();
    throwIfAborted(signal);
    const done = position.part === parts.length;
    return { rows, scanned, bytes, done, scope, ordering: ORDER,
      cursor: done ? null : Buffer.from(JSON.stringify({ version: 1, scope, query, ...position })).toString('base64url') };
  };
  const closeSession = async (session, primary, primaryPresent) => {
    try { await session.close(); }
    catch (error) { throw primaryPresent ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; }
  };
  const readPage = async options => {
    const session = createRetainedEvidenceSession(indexDir);
    let result, primary, primaryPresent = false;
    try { result = await readOwnedPage(session, options); }
    catch (error) { primary = observeStorageResource(error, { phase: 'retained-evidence-page' }).retain(); primaryPresent = true; }
    await closeSession(session, primary, primaryPresent);
    if (primaryPresent) throw primary;
    throwIfAborted(options?.signal);
    return result;
  };
  const iteratePages = (options = {}) => {
    const session = createRetainedEvidenceSession(indexDir);
    const iterator = (async function* () {
      let primary, primaryPresent = false;
      // Abort also drains while the consumer is paused between pages. The
      // observed completion is awaited again in finally; no close is replayed.
      const onAbort = () => { session.close().catch(() => {}); };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        let cursor = options.cursor ?? null;
        do {
          const page = await readOwnedPage(session, { ...options, cursor });
          // Terminal publication is withheld until the actual owner closes.
          if (page.done) await session.close();
          yield page;
          cursor = page.cursor;
        } while (cursor !== null);
      } catch (error) {
        primary = observeStorageResource(error, { phase: 'retained-evidence-enumeration' }).retain();
        primaryPresent = true;
        throw primary;
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
        await closeSession(session, primary, primaryPresent);
      }
    })();
    Object.defineProperty(iterator, 'getDiagnostics', { value: session.getDiagnostics });
    return iterator;
  };
  return { readPage, iteratePages, scope, async *iterateRows(options = {}) {
    if (options.cursor != null) throw new TypeError('Whole occurrence enumeration starts at the pinned beginning.');
    for await (const page of iteratePages(options)) yield* page.rows;
  } };
};
