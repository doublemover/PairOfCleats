import { performance } from 'node:perf_hooks';
import { historySemanticSpans, normalizeHistoryVector } from './semantic-values.js';
import { digest, historyError } from './common.js';
import { historyIndexState } from './generation.js';
import { createLocalHistorySemanticAdapter } from './semantic-adapter.js';
import { parseHistoryQuery, matchesHistoryHardConstraints } from './query.js';
import { runHistoryCallback } from './bounded-callback.js';
import { planHistoryTokenBatches } from './token-batches.js';

const invalid = () => historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid archive embedding controls.');
const visible = 'FROM units u JOIN records r ON r.id=u.record_id WHERE r.deleted=0 AND r.excluded=0';

/** Independent document generations, full-vector cache and source occurrence references. */
export function createPersistentHistorySemanticIndex(db, runtime) {
  const { config } = runtime, dimensions = config.profile.dimensions, fullDimensions = config.fullDimensions;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_embedding_meta'").get()) {
    throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive embedding v1 requires explicit copy conversion before v2 use.');
  }
  const documentKey = config.documentIdentityKey;
  if (!documentKey || !Number.isSafeInteger(fullDimensions) || dimensions > fullDimensions) throw invalid();
  db.exec([
    'CREATE TABLE IF NOT EXISTS history_embedding_generations_v2 (document_key TEXT PRIMARY KEY,identity TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS history_embedding_units_v2 (document_key TEXT NOT NULL REFERENCES history_embedding_generations_v2(document_key),unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,content_hash TEXT NOT NULL,expected_spans INTEGER NOT NULL,complete INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(document_key,unit_id));',
    'CREATE TABLE IF NOT EXISTS history_embedding_inputs_v2 (document_key TEXT NOT NULL REFERENCES history_embedding_generations_v2(document_key),input_key TEXT NOT NULL,effective_input TEXT NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(document_key,input_key));',
    'CREATE TABLE IF NOT EXISTS history_embedding_spans_v2 (document_key TEXT NOT NULL,unit_id TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,input_key TEXT NOT NULL,PRIMARY KEY(document_key,unit_id,start,end),FOREIGN KEY(document_key,unit_id) REFERENCES history_embedding_units_v2(document_key,unit_id) ON DELETE CASCADE,FOREIGN KEY(document_key,input_key) REFERENCES history_embedding_inputs_v2(document_key,input_key));',
    'CREATE INDEX IF NOT EXISTS history_embedding_refs_v2 ON history_embedding_spans_v2(document_key,input_key);',
    'CREATE TRIGGER IF NOT EXISTS history_embedding_changed_v2 AFTER UPDATE OF text,metadata ON units BEGIN DELETE FROM history_embedding_units_v2 WHERE unit_id=new.id; END;',
    'CREATE TRIGGER IF NOT EXISTS history_embedding_hidden_v2 AFTER UPDATE OF deleted,excluded ON records WHEN new.deleted!=0 OR new.excluded!=0 BEGIN DELETE FROM history_embedding_units_v2 WHERE unit_id IN (SELECT id FROM units WHERE record_id=new.id); END;',
    'CREATE TRIGGER IF NOT EXISTS history_embedding_gc_v2 AFTER DELETE ON history_embedding_spans_v2 BEGIN DELETE FROM history_embedding_inputs_v2 WHERE document_key=old.document_key AND input_key=old.input_key AND NOT EXISTS (SELECT 1 FROM history_embedding_spans_v2 s WHERE s.document_key=old.document_key AND s.input_key=old.input_key); END;'
  ].join('\n'));
  db.prepare('INSERT OR IGNORE INTO history_embedding_generations_v2 VALUES (?,?)').run(documentKey, JSON.stringify(config.documentIdentity));
  // Prepared once: heartbeat and per-batch work do not continually compile SQL.
  const statements = {
    total: db.prepare('SELECT count(*) AS n ' + visible),
    indexed: db.prepare('SELECT count(*) AS n ' + visible + ' AND EXISTS (SELECT 1 FROM history_embedding_units_v2 e WHERE e.document_key=? AND e.unit_id=u.id AND e.complete=1)'),
    spans: db.prepare('SELECT count(*) AS n FROM history_embedding_spans_v2 e JOIN units u ON u.id=e.unit_id JOIN records r ON r.id=u.record_id WHERE e.document_key=? AND r.deleted=0 AND r.excluded=0'),
    vectors: db.prepare('SELECT count(*) AS n FROM history_embedding_inputs_v2 WHERE document_key=?'),
    pending: db.prepare('SELECT u.id,u.text ' + visible + ' AND u.id>? AND NOT EXISTS (SELECT 1 FROM history_embedding_units_v2 e WHERE e.document_key=? AND e.unit_id=u.id AND e.complete=1) ORDER BY u.id LIMIT ?'),
    unit: db.prepare('SELECT content_hash FROM history_embedding_units_v2 WHERE document_key=? AND unit_id=?'),
    dropUnit: db.prepare('DELETE FROM history_embedding_units_v2 WHERE document_key=? AND unit_id=?'),
    addUnit: db.prepare('INSERT INTO history_embedding_units_v2 VALUES (?,?,?,?,0)'),
    existing: db.prepare('SELECT start,end FROM history_embedding_spans_v2 WHERE document_key=? AND unit_id=?'),
    cached: db.prepare('SELECT effective_input FROM history_embedding_inputs_v2 WHERE document_key=? AND input_key=?'),
    capacity: db.prepare('SELECT count(*) AS inputs,coalesce(sum(length(vector)+length(CAST(effective_input AS BLOB))),0) AS bytes FROM history_embedding_inputs_v2'),
    putVector: db.prepare('INSERT OR IGNORE INTO history_embedding_inputs_v2 VALUES (?,?,?,?)'),
    putSpan: db.prepare('INSERT OR IGNORE INTO history_embedding_spans_v2 VALUES (?,?,?,?,?)'),
    finish: db.prepare('UPDATE history_embedding_units_v2 SET complete=1 WHERE document_key=? AND unit_id=? AND expected_spans=(SELECT count(*) FROM history_embedding_spans_v2 WHERE document_key=? AND unit_id=?)')
  };
  let running = false, nativePending = false, nativeWork = null, capacity = null;
  const status = () => {
    const total = statements.total.get().n, indexed = statements.indexed.get(documentKey).n;
    return { identityKey: documentKey, documentIdentityKey: documentKey, queryIdentityKey: config.queryIdentityKey,
      representationIdentityKey: config.representationIdentityKey, modelId: config.modelId,
      modelVersion: config.profile.revision, dimensions, fullDimensions, profile: config.profile,
      queryPrefix: config.queryPrefix, passagePrefix: config.passagePrefix, totalUnits: total,
      indexedUnits: indexed, pendingUnits: total - indexed, indexedSpans: statements.spans.get(documentKey).n,
      uniqueInputs: statements.vectors.get(documentKey).n, complete: indexed === total,
      generationRef: historyIndexState(db).generationRef, nativeWorkPending: nativePending,
      storage: 'archive_sqlite', scope: 'visible_redacted_projected_text', media: false };
  };
  const commit = db.transaction((inputs, occurrences) => {
    let addedInputs = 0, addedBytes = 0;
    for (const row of inputs) {
      if (!statements.cached.get(documentKey, row.inputKey)) {
        addedInputs++; addedBytes += fullDimensions * 4 + Buffer.byteLength(row.effectiveInput);
      }
    }
    if (capacity && (capacity.inputs + addedInputs > capacity.maxInputs || capacity.bytes + addedBytes > capacity.maxBytes)) {
      throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Archive derived embedding cache capacity exceeded.');
    }
    for (const row of inputs) {
      const vector = normalizeHistoryVector(row.vector, fullDimensions), blob = Buffer.allocUnsafe(fullDimensions * 4);
      for (let i = 0; i < fullDimensions; i++) blob.writeFloatLE(vector[i], i * 4);
      statements.putVector.run(documentKey, row.inputKey, row.effectiveInput, blob);
    }
    for (const row of occurrences) statements.putSpan.run(documentKey, row.unitId, row.start, row.end, row.inputKey);
    for (const unitId of new Set(occurrences.map(row => row.unitId))) statements.finish.run(documentKey, unitId, documentKey, unitId);
    if (capacity) { capacity.inputs += addedInputs; capacity.bytes += addedBytes; }
  });
  const refresh = async (options = {}) => {
    if (running || nativePending) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'Archive embedding native work is still running.');
    const { maxUnits = 100, maxMillis = 30000, batchSize = config.batchSize, maxBatchChars = 16000,
      lookahead = config.lookahead ?? Math.min(256, batchSize * 8), maxPaddedTokens = config.maxPaddedTokens ?? 32768,
      maxAttentionTokens = config.maxAttentionTokens ?? 67108864,
      maxCacheInputs = config.maxCacheInputs ?? 1000000, maxCacheBytes = config.maxCacheBytes ?? 8589934592, signal: inputSignal } = options;
    if (Object.keys(options).some(key => !['maxUnits','maxMillis','batchSize','maxBatchChars','lookahead','maxPaddedTokens','maxAttentionTokens','maxCacheInputs','maxCacheBytes','signal'].includes(key))
      || !Number.isSafeInteger(maxUnits) || maxUnits < 1 || maxUnits > 1000000
      || !Number.isSafeInteger(maxMillis) || maxMillis < 100 || maxMillis > 600000
      || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64
      || !Number.isSafeInteger(maxBatchChars) || maxBatchChars < config.chunkChars || maxBatchChars > 256000
      || !Number.isSafeInteger(lookahead) || lookahead < batchSize || lookahead > 256
      || !Number.isSafeInteger(maxPaddedTokens) || maxPaddedTokens < 1 || maxPaddedTokens > 524288
      || !Number.isSafeInteger(maxAttentionTokens) || maxAttentionTokens < 1 || maxAttentionTokens > 4294967296
      || !Number.isSafeInteger(maxCacheInputs) || maxCacheInputs < 1 || maxCacheInputs > 10000000
      || !Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < fullDimensions * 4 || maxCacheBytes > 68719476736) throw invalid();
    const signal = AbortSignal.any([AbortSignal.timeout(maxMillis), ...(inputSignal ? [inputSignal] : [])]);
    const generation = historyIndexState(db).generationRef;
    capacity = { ...statements.capacity.get(), maxInputs: maxCacheInputs, maxBytes: maxCacheBytes };
    const timings = { prepareMs: 0, encodeMs: 0, transactionMs: 0 };
    let encoded = 0, reused = 0, processed = 0, batches = 0, stopped = null, nativeCancellation = null, paddedTokens = 0, actualTokens = 0;
    const check = () => {
      signal.throwIfAborted();
      if (historyIndexState(db).generationRef !== generation) throw historyError('ERR_INFERENCE_HISTORY_STALE', 'Archive changed during embedding refresh.');
    };
    const write = (inputs, occurrences) => {
      check(); const started = performance.now(); commit(inputs, occurrences); timings.transactionMs += performance.now() - started;
    };
    let pending = new Map(), pendingOccurrences = 0, pendingCached = [], last = '';
    const flushCached = () => { if (pendingCached.length) { write([], pendingCached); pendingCached = []; } };
    const reuse = occurrence => { pendingCached.push(occurrence); reused++; if (pendingCached.length >= lookahead * 4) flushCached(); };
    const flush = async () => {
      flushCached();
      if (!pending.size) return;
      check();
      const rows = [...pending.values()], prepareStart = performance.now();
      nativePending = true;
      const preparation = Promise.resolve().then(() => runtime.prepareBatch(rows.map(row => row.text), { signal }));
      nativeWork = preparation;
      preparation.then(() => { if (nativeWork === preparation) { nativePending = false; nativeWork = null; } },
        () => { if (nativeWork === preparation) { nativePending = false; nativeWork = null; } });
      const prepared = await runHistoryCallback(() => preparation, signal);
      timings.prepareMs += performance.now() - prepareStart; check();
      const lengths = prepared.map(row => row.tokenLength);
      const plans = planHistoryTokenBatches(rows, lengths, { batchSize, maxBatchChars, maxPaddedTokens, maxAttentionTokens });
      for (const indices of plans) {
        check();
        const encodeStart = performance.now();
        nativePending = true;
        const work = Promise.resolve().then(() => runtime.encodePrepared(indices.map(index => prepared[index]), { signal }));
        nativeWork = work;
        work.then(() => { if (nativeWork === work) { nativePending = false; nativeWork = null; } },
          () => { if (nativeWork === work) { nativePending = false; nativeWork = null; } });
        const results = await runHistoryCallback(() => work, signal);
        timings.encodeMs += performance.now() - encodeStart; check();
        if (!Array.isArray(results) || results.length !== indices.length) throw invalid();
        const selected = indices.map((index, offset) => ({ ...rows[index], vector: results[offset] }));
        write(selected, selected.flatMap(row => row.occurrences));
        encoded += selected.length; batches++;
        actualTokens += indices.reduce((sum, index) => sum + lengths[index], 0);
        paddedTokens += indices.length * Math.max(...indices.map(index => lengths[index]));
      }
      pending = new Map(); pendingOccurrences = 0;
    };
    running = true;
    try {
      while (processed < maxUnits) {
        check();
        const units = statements.pending.all(last, documentKey, Math.min(100, maxUnits - processed));
        if (!units.length) break;
        for (const unit of units) {
          check(); last = unit.id;
          const spans = Array.from(historySemanticSpans(unit.text, config.chunkChars, config.overlapChars)), hash = digest(unit.text);
          if (statements.unit.get(documentKey, unit.id)?.content_hash !== hash) db.transaction(() => {
            statements.dropUnit.run(documentKey, unit.id);
            statements.addUnit.run(documentKey, unit.id, hash, spans.length);
          })();
          const existing = new Set(statements.existing.all(documentKey, unit.id).map(span => span.start + ':' + span.end));
          for (const span of spans) {
            if (existing.has(span.start + ':' + span.end)) { reused++; continue; }
            const effectiveInput = runtime.effectiveInput(span.text), inputKey = digest(JSON.stringify([documentKey, effectiveInput]));
            const occurrence = { unitId: unit.id, start: span.start, end: span.end, inputKey };
            const cached = statements.cached.get(documentKey, inputKey);
            if (cached) {
              if (cached.effective_input !== effectiveInput) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive input digest collision.');
              reuse(occurrence); continue;
            }
            if ((!pending.has(inputKey) && pending.size >= lookahead) || pendingOccurrences >= lookahead * 4) await flush();
            // A preceding flush may have encoded this input.
            const afterFlush = statements.cached.get(documentKey, inputKey);
            if (afterFlush) {
              if (afterFlush.effective_input !== effectiveInput) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive input digest collision.');
              reuse(occurrence); continue;
            }
            const queued = pending.get(inputKey);
            if (queued) {
              if (queued.effectiveInput !== effectiveInput) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Archive input digest collision.');
              queued.occurrences.push(occurrence); reused++;
            }
            else pending.set(inputKey, { text: span.text, effectiveInput, inputKey, occurrences: [occurrence] });
            pendingOccurrences++;
          }
          if (!spans.length) statements.finish.run(documentKey, unit.id, documentKey, unit.id);
          processed++;
        }
      }
      await flush();
    } catch (error) {
      if (signal.aborted) {
        stopped = inputSignal?.aborted ? 'cancelled' : 'deadline';
        nativeCancellation = { supported: typeof runtime.cancel === 'function', requestAccepted: false, workerStopped: false };
        if (nativeCancellation.supported) {
          try {
            const receipt = await runtime.cancel(stopped);
            if (receipt && typeof receipt === 'object') nativeCancellation = { ...receipt, supported: true };
            if (nativeCancellation.workerStopped === true && nativeWork) await Promise.allSettled([nativeWork]);
          } catch (cancelError) {
            nativeCancellation = { supported: true, requestAccepted: null, workerStopped: false,
              errorCode: typeof cancelError?.code === 'string' ? cancelError.code : 'ERR_INFERENCE_HISTORY_CANCEL' };
          }
        }
      }
      else throw error;
    } finally { running = false; capacity = null; }
    const coverage = status();
    return { ...coverage, admittedUnits: processed, encodedSpans: encoded, reusedSpans: reused, batches, stopped, nativeCancellation,
      actualTokens, paddedTokens, timings, resumable: true, exhaustiveCoverage: coverage.complete };
  };
  const adapter = () => {
    const coverage = status();
    if (!coverage.indexedSpans || !coverage.indexedUnits) return null;
    const generation = coverage.generationRef;
    return Object.freeze({ ...createLocalHistorySemanticAdapter({
      modelId: config.modelId, modelVersion: config.profile.revision, dimensions, indexGenerationRef: generation,
      contentManifestHash: digest(JSON.stringify([documentKey, config.queryIdentityKey, config.representationIdentityKey, generation, coverage.indexedUnits, coverage.indexedSpans])),
      encodeQuery: (query, options) => runtime.encodeQuery(query, options),
      async searchIndex(query, { top, signal, request = {} }) {
        const vector = normalizeHistoryVector(query, dimensions), parsed = parseHistoryQuery(request.query);
        const history = request.includeHistory === true || request.snapshotRef != null;
        const date = (value, end) => value?.length === 10 ? value + 'T' + (end ? '23:59:59.999' : '00:00:00.000') + 'Z' : value ?? null;
        const from = date(request.dateFrom, false), to = date(request.dateTo, true), role = request.role ?? null, path = request.pathState ?? 'all';
        const sql = [
          'SELECT e.unit_id AS sourceRef,e.start,e.end,c.vector,u.text,',
          "(SELECT s.snapshot_id FROM snapshot_units s WHERE s.unit_id=u.id AND (?=1 OR s.snapshot_id=r.latest_snapshot) AND (? IS NULL OR s.snapshot_id=?) AND (?='all' OR s.path_state=?) ORDER BY s.snapshot_id LIMIT 1) AS snapshotRef",
          'FROM history_embedding_spans_v2 e JOIN history_embedding_units_v2 done ON done.document_key=e.document_key AND done.unit_id=e.unit_id JOIN history_embedding_inputs_v2 c ON c.document_key=e.document_key AND c.input_key=e.input_key JOIN units u ON u.id=e.unit_id JOIN records r ON r.id=u.record_id',
          "WHERE e.document_key=? AND done.complete=1 AND r.deleted=0 AND r.excluded=0 AND (? IS NULL OR json_extract(u.metadata,'$.role')=?) AND (? IS NULL OR json_extract(u.metadata,'$.createdAt.utc')>=?) AND (? IS NULL OR json_extract(u.metadata,'$.createdAt.utc')<=?) ORDER BY e.unit_id,e.start"
        ].join(' ');
        const ranked = []; let matched = 0, visited = 0, lastSource = '';
        for (const row of db.prepare(sql).iterate(history ? 1 : 0, request.snapshotRef ?? null, request.snapshotRef ?? null, path, path, documentKey, role, role, from, from, to, to)) {
          signal?.throwIfAborted(); visited++;
          if (visited % 100 === 0) await new Promise(resolve => setImmediate(resolve));
          if (!row.snapshotRef || !matchesHistoryHardConstraints(row.text, parsed)) continue;
          if (row.vector.length !== fullDimensions * 4) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Invalid persisted archive vector.');
          let score = 0, norm = 0;
          for (let i = 0; i < dimensions; i++) { const item = row.vector.readFloatLE(i * 4); score += vector[i] * item; norm += item * item; }
          score /= Math.sqrt(norm);
          if (!Number.isFinite(score)) throw historyError('ERR_INFERENCE_HISTORY_STORAGE', 'Invalid persisted archive vector.');
          const key = JSON.stringify([row.sourceRef, row.snapshotRef]), previous = ranked.find(row => row.key === key);
          if (lastSource !== key) { matched++; lastSource = key; }
          if (previous) { if (score > previous.score) { previous.score = score; previous.span = { start: row.start, end: row.end }; } }
          else ranked.push({ key, sourceRef: row.sourceRef, snapshotRef: row.snapshotRef, span: { start: row.start, end: row.end }, score });
          ranked.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
          if (ranked.length > top) ranked.pop();
        }
        return { candidates: ranked.map(({ key: _key, score: _score, ...row }) => row), complete: coverage.complete && matched <= top };
      }
    }), coverage });
  };
  return Object.freeze({ status, refresh, adapter });
}
