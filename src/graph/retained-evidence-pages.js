import path from 'node:path';
import { MAX_JSON_BYTES } from '../shared/artifact-io/constants.js';
import { readJsonFile } from '../shared/artifact-io/json.js';
import { assertPiecesManifestFormat } from '../shared/artifact-io/manifest-read.js';
import { resolveManifestPath } from '../shared/artifact-io/manifest-paths.js';
import { sortManifestEntries } from '../shared/artifact-io/manifest-entry-selection.js';
import { openJsonlRowReader } from '../shared/artifact-io/offsets.js';
import { semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';

const MAX_ROWS = 512;
const MAX_SCAN_ROWS = 4096;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_ROW_BYTES = 32768;
const normalizeManifest = raw => raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
const manifestHash = manifest => semanticHash('graph.retained-evidence.publication.v1', manifest);
const checksum = (piece, fail) => {
  const match = /^(sha1|sha256):([a-f0-9]+)$/.exec(piece?.checksum || '');
  if (!match || match[2].length !== (match[1] === 'sha1' ? 40 : 64)) throw fail('Retained-evidence paging requires registered content checksums.');
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
 * Verification still reads each touched immutable piece; no speedup is claimed.
 */
export const createRetainedEvidencePages = ({ indexDir, manifest, maxBytes = MAX_JSON_BYTES,
  family, ordering, normalizeFilter, matches, validateRow, errorPrefix, maxRowBytes = MAX_ROW_BYTES }) => {
  const fail = (message, code = 'ERR_CALL_SITE_PAGE_INTEGRITY') => Object.assign(new Error(message), {
    code: code.replace('ERR_CALL_SITE_', 'ERR_' + errorPrefix + '_')
  });
  const ORDER = ordering;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('Retained-evidence piece read allowance must be positive and bounded.');
  const pinned = structuredClone(manifest);
  assertPiecesManifestFormat(indexDir, pinned);
  const scope = semanticHash('graph.retained-evidence.cursor-scope.v1', {
    root: path.resolve(indexDir), manifest: pinned, family, ordering: ORDER
  });
  const pinnedHash = manifestHash(pinned);
  const pieces = sortManifestEntries(pinned.pieces.filter(piece => piece.name === family));
  if (new Set(pieces.map(piece => piece.path)).size !== pieces.length) throw fail('Duplicate retained-evidence physical inventory.');
  if (!pieces.length) throw fail('Retained-evidence family is not registered.', 'ERR_CALL_SITE_PAGING_UNAVAILABLE');
  const parts = pieces.map(piece => {
    if (!piece.path?.endsWith('.jsonl') || piece.compression && piece.compression !== 'none') {
      throw fail('This retained evidence representation has no positioned JSONL page route.', 'ERR_CALL_SITE_PAGING_UNAVAILABLE');
    }
    const offsets = pinned.pieces.find(candidate => candidate.name === family + '_offsets'
      && candidate.path === piece.path + '.offsets.bin');
    if (!offsets || !Number.isSafeInteger(piece.count) || piece.count < 0
      || offsets.count !== piece.count || !Number.isSafeInteger(piece.bytes) || piece.bytes < 0
      || !Number.isSafeInteger(offsets.bytes) || offsets.bytes !== piece.count * 8
      || piece.bytes > maxBytes) throw fail('Retained-evidence piece/offset inventory is incomplete or exceeds its read allowance.');
    return { piece, offsets, dataHash: checksum(piece, fail), offsetsHash: checksum(offsets, fail) };
  });
  const assertPublication = () => {
    // Bypass timestamp caches: equal metadata does not qualify the same generation.
    const current = normalizeManifest(readJsonFile(path.join(indexDir, 'pieces', 'manifest.json'), {
      maxBytes, containedRoot: indexDir, recoveryFallback: false
    }));
    if (manifestHash(current) !== pinnedHash) throw fail('Retained-evidence cursor publication changed.', 'ERR_CALL_SITE_CURSOR_SCOPE');
  };
  const readPage = async ({ filter: inputFilter = {}, cursor = null, limit = 128,
    scanRows = 1024, maxPageBytes = 1024 * 1024, signal = null } = {}) => {
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
      const { piece, offsets, dataHash, offsetsHash } = parts[position.part];
      if (position.row === piece.count) { position = { part: position.part + 1, row: 0 }; continue; }
      const reader = await openJsonlRowReader(resolveManifestPath(indexDir, piece.path, true),
        resolveManifestPath(indexDir, offsets.path, true), { containedRoot: indexDir });
      let primary = null;
      try {
        await reader.verify({ jsonlBytes: piece.bytes, offsetsBytes: offsets.bytes,
          jsonlHash: dataHash.value, offsetsHash: offsetsHash.value,
          jsonlHashAlgorithm: dataHash.algorithm, offsetsHashAlgorithm: offsetsHash.algorithm, signal });
        await reader.validateOffsets({ signal });
        while (position.row < piece.count && scanned < scanLimit && rows.length < rowsLimit) {
          const [row] = await reader.readRows([position.row], { maxBytes: maxRowBytes, signal });
          if (!validateRow(row)) throw fail('Invalid canonical retained-evidence row.');
          const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
          if (matches(row, filter)) {
            if (rowBytes > bytesLimit && !rows.length) throw fail('Page byte allowance cannot contain the next occurrence.', 'ERR_CALL_SITE_PAGE_BYTES');
            if (bytes + rowBytes > bytesLimit) break;
            rows.push(row); bytes += rowBytes;
          }
          position.row += 1; scanned += 1;
        }
      } catch (error) { primary = error; throw error; }
      finally {
        try { await reader.close(); }
        catch (error) { if (primary) primary.cleanupError ||= error; else throw error; }
      }
      if (position.row === piece.count) position = { part: position.part + 1, row: 0 };
      else break;
    }
    assertPublication();
    throwIfAborted(signal);
    const done = position.part === parts.length;
    return { rows, scanned, bytes, done, scope, ordering: ORDER,
      cursor: done ? null : Buffer.from(JSON.stringify({ version: 1, scope, query, ...position })).toString('base64url') };
  };
  return { readPage, scope, async *iterateRows(options = {}) {
    if (options.cursor != null) throw new TypeError('Whole occurrence enumeration starts at the pinned beginning.');
    let cursor = null;
    do {
      const page = await readPage({ ...options, cursor });
      yield* page.rows;
      cursor = page.cursor;
    } while (cursor !== null);
  } };
};
