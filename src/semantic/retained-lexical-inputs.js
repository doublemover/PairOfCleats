import { readRetainedSemanticSourceSnapshot } from './retained-source-snapshot.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { validateSemanticRecord } from '../contracts/validators/semantic.js';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';

const key = canonicalSemanticJson;
export const retainedLexicalInputError = message => Object.assign(new TypeError(message), { code: 'ERR_BINDING_QUERY_CONTRACT' });
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
export const retainedLexicalSourceSpan = (value, span) => Array.isArray(span) && span.length === 2
  && span.every(offset => Number.isSafeInteger(offset) && offset >= 0 && offset <= value.length
    && (offset === 0 || offset === value.length || !(value.charCodeAt(offset - 1) >= 0xd800 && value.charCodeAt(offset - 1) <= 0xdbff
      && value.charCodeAt(offset) >= 0xdc00 && value.charCodeAt(offset) <= 0xdfff))) && span[0] <= span[1];

/** Request-local capture shared by retained lookup and inert rename planning.
 * Physical inventory completion never manufactures profile or reference closure. */
export const captureRetainedLexicalInputs = async ({ store, world, profile, partitionId, closures, annotations, selection,
  maxRows = 16384, maxMetadataBytes = 4 * 1024 * 1024, maxSourceBytes = 8 * 1024 * 1024, signal = null }) => {
  throwIfAborted(signal);
  const fail = retainedLexicalInputError;
  if (store?.backend !== 'artifact' || !world || !/^sy1:[a-f0-9]{64}$/.test(partitionId)
    || !(closures instanceof Map) || closures.size > 16384 || !(annotations instanceof Map) || annotations.size > 65536
    || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 65536
    || !Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1024 || maxMetadataBytes > 4 * 1024 * 1024
    || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024 || maxSourceBytes > 8 * 1024 * 1024) {
    throw fail('Bounded generation-pinned retained lexical inputs required.');
  }
  let retainedMetadataBytes = 0;
  const charge = encoded => {
    retainedMetadataBytes += Buffer.byteLength(encoded);
    if (retainedMetadataBytes > maxMetadataBytes) throw fail('Retained lexical metadata allowance exhausted.');
  };
  const pin = value => { const encoded = key(value); charge(encoded); return JSON.parse(encoded); };
  world = pin(world); profile = pin(profile); selection = pin(selection);
  if (key(assertSemanticEnvelope('generation', world.generation)) !== key(store.generation)
    || Object.keys(world).some(name => !['generation', 'repositoryNamespace', 'contextKey', 'sourceSnapshotId'].includes(name))
    || !text(world.repositoryNamespace) || !text(world.contextKey)
    || Object.hasOwn(world, 'sourceSnapshotId') && !text(world.sourceSnapshotId)) {
    throw fail('Bounded generation-pinned retained lexical inputs required.');
  }
  const pinMap = input => new Map([...input].map(([ref, value]) => {
    let decoded;
    try { if (typeof ref !== 'string') throw fail('Canonical profile map reference required.'); decoded = JSON.parse(ref); }
    catch { throw fail('Canonical profile map reference required.'); }
    if (!validateSemanticRecord('recordRef', decoded).ok || decoded.partitionId !== partitionId || key(decoded) !== ref) {
      throw fail('Profile annotation refers outside the selected lexical partition.');
    }
    charge(ref); return [ref, pin(value)];
  }));
  closures = pinMap(closures); annotations = pinMap(annotations);
  const captured = await readRetainedSemanticSourceSnapshot({ store, partitionId,
    repositoryNamespace: world.repositoryNamespace, maxBytes: maxSourceBytes, signal });
  if (captured.source.mapping !== null) throw fail('Retained lexical binding requires an independently qualified original-source mapping.');
  charge(key(captured.source));
  const sourceSnapshotId = semanticHash('semantic.retained-lexical-source.v1', {
    source: captured.source, partitionId, storeScope: store.cursorScope || null
  });
  if (Object.hasOwn(world, 'sourceSnapshotId') && world.sourceSnapshotId !== sourceSnapshotId) {
    throw fail('Retained lexical source snapshot differs from the requested world.');
  }
  world = { ...world, sourceSnapshotId };
  const records = [], byRef = new Map();
  let scannedRows = 0, truncated = false;
  for await (const record of store.iterateRows(partitionId, 'semantic_records', { signal, batchRows: 1 })) {
    throwIfAborted(signal);
    if (!validateSemanticRecord('node', record).ok || record.id !== scannedRows++) {
      throw fail('Retained lexical syntax IDs are not a dense canonical inventory.');
    }
    if (record.scope !== null && record.scope.partitionId !== partitionId) throw fail('Cross-partition scope is outside the file-local lexical profile.');
    if (['scope', 'declaration', 'occurrence'].includes(record.kind)) {
      if (!retainedLexicalSourceSpan(captured.text, record.span) || record.kind === 'scope' && record.data.parent !== null
        && record.data.parent.partitionId !== partitionId) throw fail('Retained lexical record source coordinates are unavailable.');
      if (record.kind === 'scope' && key(record.scope) !== key(record.data.parent)) throw fail('Retained lexical scope parent fields disagree.');
      const owned = pin(record);
      records.push(owned); byRef.set(key({ partitionId, localId: record.id }), owned);
    }
    // Exact allowance remains a prefix without a separately charged lookahead.
    if (scannedRows === maxRows) { truncated = true; break; }
  }
  if (truncated) closures = new Map([...closures].map(([ref, closure]) => [ref,
    { ...closure, declarationsClosed: false, parentClosed: false }]));
  throwIfAborted(signal);
  return { world, profile, selection, closures, annotations, captured, records, byRef, pin,
    projection: { kind: 'retained-canonical-lexical/v1', partitionId, storeScope: store.cursorScope || null,
      scannedRows, retainedMetadataBytes, sourceReadBytes: captured.bytes.length, truncated,
      inputInventoryHash: semanticHash('semantic.retained-lexical-input.v1', { sourceSnapshotId, records }),
      profileHash: semanticHash('semantic.retained-lexical-profile.v1', { profile,
        closures: [...closures].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
        annotations: [...annotations].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) }),
      profileAnnotations: 'trusted-upstream-admission', sourceLanguageClosure: 'not-implied', editAuthority: 'none' },
    metadataBytes: () => retainedMetadataBytes };
};
