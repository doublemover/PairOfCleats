import { hashCanonicalJson, normalizeTimestamp } from './normalize.js';
import { privateReference, historyError, projectHistoryText, redactHistoryText } from './common.js';

export const READ_GUARDS = Symbol('history-read-guards');
const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid inference-history read request.');
const opaque = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const PATHS = ['all', 'on_selected_path', 'off_selected_path', 'unknown'];
const MAX_CANDIDATES = 1000;
const MAX_RAW_BYTES = 64 * 1024 * 1024;
const integer = (value, fallback, min, max) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw invalid();
  return result;
};
const safeChannel = message => message.channel == null || ['final', 'commentary'].includes(message.channel);
const visible = message => message && ['user', 'assistant'].includes(message.author?.role ?? message.role)
  && safeChannel(message) && (message.recipient == null || message.recipient === 'all')
  && (message.metadata?.is_visually_hidden_from_conversation == null
    || message.metadata.is_visually_hidden_from_conversation === false);
const textParts = content => {
  if (typeof content === 'string') return content;
  const parts = Array.isArray(content) ? content : content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.flatMap(part => typeof part === 'string' ? [part]
    : ['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string' ? [part.text] : []).join('\n');
};

/** Default derivatives admit explicit public text types and channels only. */
export function visibleNode(raw, kind, nodeId) {
  if (kind === 'exported_conversation') {
    const node = raw.mapping?.[nodeId], message = node?.message;
    if (!visible(message) || !['text', 'multimodal_text'].includes(message.content?.content_type)) return null;
    return { nodeId, messageId: typeof message.id === 'string' ? message.id : null,
      role: message.author?.role ?? message.role, channel: message.channel ?? null, text: textParts(message.content),
      createdAt: normalizeTimestamp(message.create_time), payloadHash: hashCanonicalJson(message),
      attachments: Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : [] };
  }
  const turn = raw.turns?.find(value => value.id === nodeId);
  if (!turn || !safeChannel(turn)) return null;
  const items = [...(turn.input_items ?? []), ...(turn.output_items ?? [])].filter(item =>
    item?.type === 'message' && visible({ ...item, role: item.role ?? turn.role }));
  if (!items.length) return null;
  const roles = [...new Set(items.map(item => item.role ?? turn.role))];
  // A mixed-role turn cannot honestly be presented as one role-labelled message.
  if (roles.length !== 1) return null;
  return { nodeId, messageId: null, role: roles[0], channel: null,
    text: items.map(item => textParts(item.content)).join('\n'),
    createdAt: normalizeTimestamp(turn.create_time), payloadHash: hashCanonicalJson(items), attachments: [] };
}

export function artifactReferences(node) {
  const references = new Map();
  for (const match of node.text.matchAll(/(?:sandbox:\/|https?:\/\/|attachment:\/\/)[^\s<>"\])]+/g)) {
    const reference = redactHistoryText(match[0]).slice(0, 2048);
    if (references.size < 16) references.set(reference, { reference, availability: 'unknown',
      instructionAuthority: 'none', filesystemAuthority: 'none' });
  }
  for (const attachment of node.attachments.slice(0, 16)) {
    const name = typeof attachment?.name === 'string' ? attachment.name : attachment?.file_name;
    const id = attachment?.id ?? attachment?.file_id;
    if (typeof id !== 'string' || references.size >= 16) continue;
    const reference = redactHistoryText(id).slice(0, 512);
    references.set(reference, { reference, name: typeof name === 'string' ? redactHistoryText(name).slice(0, 256) : null,
      availability: 'unknown', instructionAuthority: 'none', filesystemAuthority: 'none' });
  }
  return [...references.values()];
}

const words = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
const matches = (text, tokens) => {
  const present = new Set(words(text));
  return tokens.every(token => words(token).every(word => present.has(word)));
};
export function centeredSnippet(text, tokens, chars) {
  let normalized = '';
  const offsets = [];
  for (let offset = 0; offset < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(offset));
    const folded = character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    normalized += folded;
    for (let index = 0; index < folded.length; index++) offsets.push(offset);
    offset += character.length;
  }
  const positions = tokens.map(token => {
    const index = normalized.indexOf(token.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());
    return index < 0 ? -1 : offsets[index];
  }).filter(index => index >= 0);
  const position = positions.length ? Math.min(...positions) : 0;
  let start = Math.max(0, Math.min(position - Math.floor(chars / 3), text.length - chars));
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  let end = Math.min(text.length, start + chars);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return { text: text.slice(start, end), start, end, totalChars: text.length,
    truncated: start > 0 || end < text.length, matchedTokens: tokens.filter(token => matches(text, [token])) };
}

const cacheFor = (db, request) => {
  const snapshots = new Map();
  let bytes = 0;
  const started = Date.now();
  return snapshotRef => {
    request.signal?.throwIfAborted();
    if (Date.now() - started > 30000) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'History read time limit exceeded.');
    if (snapshots.has(snapshotRef)) return snapshots.get(snapshotRef);
    const row = db.prepare('SELECT raw_json, source_kind, record_id, title FROM snapshots WHERE id=?').get(snapshotRef);
    if (!row) return null;
    bytes += Buffer.byteLength(row.raw_json);
    if (bytes > MAX_RAW_BYTES) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'History read evidence budget exceeded.');
    const value = { ...row, raw: JSON.parse(row.raw_json) };
    snapshots.set(snapshotRef, value);
    return value;
  };
};
const locations = (db, sourceRef, { history = true, snapshot = null, pathState = 'all' } = {}) => db.prepare(`
  WITH candidates AS MATERIALIZED (SELECT s.id AS snapshotRef, s.record_id AS recordRef, s.title, su.path_state AS pathState,
    (s.id=r.latest_snapshot) AS latest
  FROM snapshot_units su JOIN snapshots s ON s.id=su.snapshot_id JOIN records r ON r.id=s.record_id
  WHERE su.unit_id=? AND r.deleted=0 AND (?=1 OR s.id=r.latest_snapshot)
    AND (? IS NULL OR s.id=?) AND (?='all' OR su.path_state=?)
  LIMIT 1001) SELECT snapshotRef, recordRef, title, pathState FROM candidates ORDER BY latest DESC, snapshotRef
`).all(sourceRef, history ? 1 : 0, snapshot, snapshot, pathState, pathState);
const occurrences = (db, snapshotRef) => db.prepare(`SELECT import_id AS importRef, member, ordinal
  FROM occurrences WHERE snapshot_id=? ORDER BY import_id, member, ordinal LIMIT 1001`).all(snapshotRef);
const boundedProvenance = () => {
  let remaining = MAX_CANDIDATES;
  return rows => {
    remaining -= rows.length;
    if (remaining < 0) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'History provenance budget exceeded.');
    return rows;
  };
};
const reference = (db, sourceRef, location, admit) => ({
  sourceRef, ...location, occurrences: admit(occurrences(db, location.snapshotRef))
});
const guard = (result, refs) => Object.defineProperty(result, READ_GUARDS, { value: refs });
const groupKey = (row, node, namespace) => node.messageId
  ? privateReference(namespace, JSON.stringify([row.evidenceKind, node.messageId, node.payloadHash, row.projectionFingerprint]))
  : privateReference(namespace, JSON.stringify([row.sourceRef]));

function coverage(db) {
  if (!db) return { imports: 0, records: 0, units: 0, coverage: 'none', complete: false,
    indexedMessageBounds: { first: null, last: null, unknownDates: 0 }, exportCutoff: null, fullCorpusWindow: null };
  const imports = db.prepare(`SELECT COUNT(*) AS n, MIN(COALESCE(json_extract(summary,'$.complete'),0)) AS complete FROM imports`).get();
  const dates = db.prepare(`SELECT MIN(json_extract(metadata,'$.createdAt.utc')) AS first,
    MAX(json_extract(metadata,'$.createdAt.utc')) AS last,
    SUM(CASE WHEN json_extract(metadata,'$.createdAt.utc') IS NULL THEN 1 ELSE 0 END) AS unknownDates FROM units`).get();
  return { imports: imports.n, records: db.prepare('SELECT COUNT(*) AS n FROM records WHERE deleted=0').get().n,
    units: db.prepare('SELECT COUNT(*) AS n FROM units').get().n, coverage: imports.n ? 'selected_input' : 'none',
    complete: imports.n > 0 && imports.complete === 1, indexedMessageBounds: dates,
    exportCutoff: null, fullCorpusWindow: null,
    caveats: ['Bounds describe stored unit dates, not complete archive coverage or an export cutoff.',
      'No media decoding, Pages-directory ingestion, embeddings or semantic retrieval are provided.'] };
}
const dateBound = (value, end) => {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)) throw invalid();
  const date = new Date(value.length === 10 ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw invalid();
  return date.toISOString();
};

export function searchHistory(db, request) {
  if (typeof request.query !== 'string' || request.query.length > 4096) throw invalid();
  const tokens = [...new Set(request.query.match(/[\p{L}\p{N}_]+/gu) ?? [])];
  if (!tokens.length || tokens.length > 32) throw invalid();
  const top = integer(request.top, 10, 1, 100), offset = integer(request.offset, 0, 0, 100000);
  const snippetChars = integer(request.snippetChars, 600, 80, 2000);
  const pathState = request.pathState ?? 'all';
  if (!PATHS.includes(pathState) || (request.snapshotRef != null && !opaque(request.snapshotRef))
    || (request.includeHistory != null && typeof request.includeHistory !== 'boolean')) throw invalid();
  const role = request.role ?? null;
  if (role !== null && !['user', 'assistant'].includes(role)) throw invalid();
  const from = dateBound(request.dateFrom, false), to = dateBound(request.dateTo, true);
  if (from && to && from > to) throw invalid();
  const envelope = { query: { tokens, semantics: 'literal_word_AND', semanticMatching: false },
    filters: { role, dateFrom: from, dateTo: to, pathState, snapshotRef: request.snapshotRef ?? null,
      includeHistory: request.includeHistory === true }, coverage: coverage(db),
    limits: { top, offset, snippetChars, candidateUnits: MAX_CANDIDATES, rawEvidenceBytes: MAX_RAW_BYTES },
    caveat: 'Empty hits mean no matching visible units under these filters and selected-input coverage; never-discussed is not established.' };
  if (!db) return { ...envelope, hits: [], totalMatches: 0, totalMatchedUnits: 0, complete: true, nextOffset: null };
  const query = tokens.map(token => `"${token}"`).join(' AND ');
  const sql = `FROM units_fts JOIN units ON units.id=units_fts.id JOIN records ON records.id=units.record_id
    WHERE units_fts MATCH ? AND records.deleted=0
    AND (? IS NULL OR json_extract(units.metadata,'$.createdAt.utc')>=?)
    AND (? IS NULL OR json_extract(units.metadata,'$.createdAt.utc')<=?)
    AND EXISTS (SELECT 1 FROM snapshot_units WHERE snapshot_units.unit_id=units.id
      AND (?=1 OR snapshot_units.snapshot_id=records.latest_snapshot)
      AND (? IS NULL OR snapshot_units.snapshot_id=?) AND (?='all' OR snapshot_units.path_state=?))`;
  const history = request.includeHistory === true || request.snapshotRef != null;
  const parameters = [query, from, from, to, to, history ? 1 : 0,
    request.snapshotRef ?? null, request.snapshotRef ?? null, pathState, pathState];
  const candidateCount = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${sql} LIMIT ${MAX_CANDIDATES + 1})`).get(...parameters).n;
  const rows = db.prepare(`WITH candidates AS MATERIALIZED (SELECT units.id AS sourceRef, units.record_id AS recordRef,
    units.node_id AS nodeId, units.metadata, bm25(units_fts) AS score ${sql}
    LIMIT ?) SELECT * FROM candidates ORDER BY score, sourceRef`).all(...parameters, MAX_CANDIDATES);
  const load = cacheFor(db, request), groups = new Map(), guards = [];
  const admitLocations = boundedProvenance(), admitOccurrences = boundedProvenance();
  const namespace = db.prepare("SELECT value FROM vault_meta WHERE key='reference_key'").get().value;
  let matchedUnits = 0;
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata);
    const locs = locations(db, row.sourceRef, { history, snapshot: request.snapshotRef ?? null, pathState });
    if (locs.length > MAX_CANDIDATES) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'History provenance budget exceeded.');
    const first = locs[0];
    if (!first) continue;
    const snapshot = load(first.snapshotRef), node = visibleNode(snapshot.raw, metadata.evidenceKind, row.nodeId);
    if (!node || (role !== null && node.role !== role)) continue;
    const projection = projectHistoryText(node.text, metadata.projection.characterBudget);
    if (!matches(projection.text, tokens)) continue;
    matchedUnits++;
    const key = groupKey({ ...metadata, ...row }, node, namespace);
    let group = groups.get(key);
    if (!group) {
      const snippet = centeredSnippet(projection.text, tokens, snippetChars);
      const { nodeRevision: _privateRevision, ...publicMetadata } = metadata;
      group = { ...publicMetadata, sourceRef: row.sourceRef, recordRef: row.recordRef, snapshotRef: first.snapshotRef,
        title: first.title, pathState: first.pathState, role: node.role,
        createdAt: { utc: node.createdAt.utc, state: node.createdAt.state }, text: snippet.text, snippet,
        score: row.score, groupRef: key, groupCount: 0, artifacts: artifactReferences(node),
        instructionAuthority: 'none', references: [] };
      groups.set(key, group);
    }
    group.groupCount++;
    for (const location of admitLocations(locations(db, row.sourceRef))) {
      const ref = reference(db, row.sourceRef, location, admitOccurrences);
      group.references.push(ref); guards.push({ sourceRef: row.sourceRef, snapshotRef: location.snapshotRef });
    }
  }
  const all = [...groups.values()];
  const hits = all.slice(offset, offset + top).map(({ references, ...hit }) => ({ ...hit,
    provenance: { totalReferences: references.length, references: references.slice(0, 3),
      nextOffset: references.length > 3 ? 3 : null, expand: 'readReferences' } }));
  const complete = candidateCount <= MAX_CANDIDATES;
  return guard({ ...envelope, hits, candidateMatches: candidateCount,
    totalMatches: complete ? all.length : null, totalMatchedUnits: complete ? matchedUnits : null,
    observedGroups: all.length, complete, nextOffset: offset + top < all.length ? offset + top : null }, guards);
}

export function readVisibleContext(db, request) {
  if (!opaque(request.snapshotRef) || !opaque(request.sourceRef)) throw invalid();
  const before = integer(request.before, 3, 0, 10), after = integer(request.after, 3, 0, 10);
  const top = integer(request.top, 6, 1, 20), chars = integer(request.messageChars, 1200, 80, 4000);
  if (request.offset != null) integer(request.offset, 0, 0, 10000);
  const anchor = db?.prepare(`SELECT units.node_id AS nodeId FROM units JOIN snapshot_units su ON su.unit_id=units.id
    JOIN snapshots s ON s.id=su.snapshot_id JOIN records r ON r.id=s.record_id
    WHERE units.id=? AND s.id=? AND r.deleted=0`).get(request.sourceRef, request.snapshotRef);
  if (!anchor) return null;
  const snapshot = cacheFor(db, request)(request.snapshotRef);
  let ids = [];
  if (snapshot.source_kind === 'exported_conversation') {
    const seen = new Set();
    let current = snapshot.raw.current_node;
    while (current && snapshot.raw.mapping?.[current] && !seen.has(current)) {
      seen.add(current); ids.unshift(current); current = snapshot.raw.mapping[current].parent;
    }
    if (!seen.has(anchor.nodeId)) {
      ids = []; seen.clear(); current = anchor.nodeId;
      while (current && snapshot.raw.mapping?.[current] && !seen.has(current)) {
        seen.add(current); ids.unshift(current); current = snapshot.raw.mapping[current].parent;
      }
    }
  } else ids = snapshot.raw.turns.map(turn => turn.id);
  const timeline = ids.map((nodeId, ordinal) => ({ node: visibleNode(snapshot.raw, snapshot.source_kind, nodeId), ordinal }))
    .filter(({ node }) => node !== null).sort((left, right) =>
      (left.node.createdAt.utc ?? '\uffff').localeCompare(right.node.createdAt.utc ?? '\uffff') || left.ordinal - right.ordinal);
  const anchorIndex = timeline.findIndex(({ node }) => node.nodeId === anchor.nodeId);
  if (anchorIndex < 0) return { snapshotRef: request.snapshotRef, sourceRef: request.sourceRef,
    messages: [], totalVisibleMessages: timeline.length, anchorVisible: false, instructionAuthority: 'none' };
  const start = request.offset ?? Math.max(0, anchorIndex - Math.min(before, top - 1));
  const end = request.offset == null ? Math.min(start + top, anchorIndex + after + 1) : start + top;
  const guards = [{ sourceRef: request.sourceRef, snapshotRef: request.snapshotRef }];
  const messages = timeline.slice(start, end).map(({ node }) => {
    const unit = db.prepare(`SELECT units.id AS sourceRef, units.metadata, su.path_state AS pathState
      FROM units JOIN snapshot_units su ON su.unit_id=units.id WHERE su.snapshot_id=? AND units.node_id=?
      ORDER BY units.id LIMIT 1`).get(request.snapshotRef, node.nodeId);
    if (unit) guards.push({ sourceRef: unit.sourceRef, snapshotRef: request.snapshotRef });
    const projection = projectHistoryText(node.text, chars);
    return { sourceRef: unit?.sourceRef ?? null, messageId: node.messageId, role: node.role, channel: node.channel,
      createdAt: { utc: node.createdAt.utc, state: node.createdAt.state }, pathState: unit?.pathState ?? 'unknown',
      text: projection.text, projection: projection.metadata, artifacts: artifactReferences(node),
      anchor: node.nodeId === anchor.nodeId, instructionAuthority: 'none' };
  });
  return guard({ snapshotRef: request.snapshotRef, sourceRef: request.sourceRef, recordRef: snapshot.record_id,
    title: snapshot.title, evidenceKind: snapshot.source_kind, messages, anchorVisible: true,
    totalVisibleMessages: timeline.length, anchorIndex, offset: start, nextOffset: start + messages.length < timeline.length ? start + messages.length : null,
    previousOffset: start > 0 ? Math.max(0, start - top) : null,
    order: 'timestamp_then_export_order_missing_dates_last', limits: { top, messageChars: chars, before, after },
    provenance: { occurrences: boundedProvenance()(occurrences(db, request.snapshotRef)) }, instructionAuthority: 'none' }, guards);
}

export function readHistoryReferences(db, request) {
  if (!opaque(request.sourceRef)) throw invalid();
  const top = integer(request.top, 20, 1, 50), offset = integer(request.offset, 0, 0, 100000);
  const seed = db?.prepare(`SELECT units.id AS sourceRef, units.node_id AS nodeId, units.metadata
    FROM units JOIN records r ON r.id=units.record_id WHERE units.id=? AND r.deleted=0`).get(request.sourceRef);
  if (!seed) return null;
  const load = cacheFor(db, request), seedMeta = JSON.parse(seed.metadata);
  const seedLocations = locations(db, seed.sourceRef);
  if (seedLocations.length > MAX_CANDIDATES) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'History provenance budget exceeded.');
  const seedLocation = seedLocations[0];
  const seedNode = visibleNode(load(seedLocation.snapshotRef).raw, seedMeta.evidenceKind, seed.nodeId);
  if (!seedNode) return null;
  const namespace = db.prepare("SELECT value FROM vault_meta WHERE key='reference_key'").get().value;
  const key = groupKey({ ...seedMeta, ...seed }, seedNode, namespace);
  const rows = seedNode.messageId ? db.prepare(`SELECT u.id AS sourceRef, u.node_id AS nodeId, u.metadata
    FROM units u JOIN records r ON r.id=u.record_id WHERE r.deleted=0 AND json_extract(u.metadata,'$.messageId')=?
    ORDER BY u.id LIMIT ?`).all(seedMeta.messageId, MAX_CANDIDATES + 1) : [seed];
  const references = [], guards = [];
  const admitLocations = boundedProvenance(), admitOccurrences = boundedProvenance();
  for (const row of rows.slice(0, MAX_CANDIDATES)) {
    const metadata = JSON.parse(row.metadata), locs = admitLocations(locations(db, row.sourceRef));
    const node = visibleNode(load(locs[0].snapshotRef).raw, metadata.evidenceKind, row.nodeId);
    if (!node || groupKey({ ...metadata, ...row }, node, namespace) !== key) continue;
    for (const location of locs) { references.push(reference(db, row.sourceRef, location, admitOccurrences));
      guards.push({ sourceRef: row.sourceRef, snapshotRef: location.snapshotRef }); }
  }
  return guard({ sourceRef: request.sourceRef, groupRef: key, references: references.slice(offset, offset + top),
    totalReferences: rows.length <= MAX_CANDIDATES ? references.length : null, complete: rows.length <= MAX_CANDIDATES,
    offset, top, nextOffset: offset + top < references.length ? offset + top : null, instructionAuthority: 'none' }, guards);
}